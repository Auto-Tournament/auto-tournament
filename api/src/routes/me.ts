/**
 * The signed-in player's own account data, keyed on the stable account id
 * (`players.uid`), not the Steam ID.
 *
 * Identity comes from the viewer-identity helpers: the *real* signed-in player.
 * An admin impersonating someone gets 403 on writes, like the Discord ID
 * self-service endpoints, because these answer for the session and an
 * impersonation should not quietly edit the other player's profile.
 */

import { Router, Request, Response } from 'express';
import {
  MAX_PLAYER_GAMES,
  UnknownGameIdsError,
  dismissGamesPrompt,
  getPlayerAccountBySteamId,
  getPlayerGames,
  setPlayerGames,
  type PlayerAccount,
} from '../services/gameCatalogService';
import { scheduleGameIconRefresh } from '../services/gameIconService';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { log } from '../utils/logger';
import { getAuthProvidersConfig } from '../config/authProviders';
import { authIdentityService } from '../services/authIdentityService';
import { playerService } from '../services/playerService';
import { listIntegrations } from '../integrations/registry';
import {
  LINKABLE_PROVIDERS,
  checkRemoveSignInMethod,
  isLinkableProvider,
  isSameSiteRequest,
} from '../utils/accountConnections';

const router = Router();

async function resolveAccount(
  req: Request,
  res: Response,
  { write, what = 'games' }: { write: boolean; what?: 'games' | 'account' }
): Promise<PlayerAccount | null> {
  const identity = await resolveViewerIdentity(req);
  if (!identity.realSteamId) {
    res.status(401).json({ success: false, error: `Sign in to manage your ${what}` });
    return null;
  }
  if (write && identity.isImpersonating) {
    res.status(403).json({
      success: false,
      error: `You are impersonating a player. Stop impersonating to manage your own ${what}.`,
    });
    return null;
  }

  const account = await getPlayerAccountBySteamId(identity.realSteamId);
  if (!account) {
    res.status(404).json({ success: false, error: 'No player record for this account' });
    return null;
  }
  return account;
}

async function gamesResponse(account: PlayerAccount) {
  const games = await getPlayerGames(account.uid);
  return {
    success: true,
    games,
    // Show "What do you play?" once: while the player has no games and has
    // neither answered nor skipped it.
    showPrompt: games.length === 0 && account.gamesPromptDismissedAt === null,
  };
}

/**
 * @openapi
 * /api/me/games:
 *   get:
 *     tags: [Me]
 *     summary: The signed-in player's games
 *     responses:
 *       200:
 *         description: Games, and whether to show the "What do you play?" prompt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 showPrompt: { type: boolean }
 *                 games:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/GameSummary'
 *       401:
 *         description: Not signed in
 *       404:
 *         description: Signed in, but no player record
 */
router.get('/games', async (req: Request, res: Response) => {
  try {
    const account = await resolveAccount(req, res, { write: false });
    if (!account) return;
    return res.json(await gamesResponse(account));
  } catch (error) {
    log.error('Error reading own games', error);
    return res.status(500).json({ success: false, error: 'Failed to load your games' });
  }
});

/**
 * @openapi
 * /api/me/games:
 *   put:
 *     tags: [Me]
 *     summary: Replace the signed-in player's games
 *     description: Body is an array of game ids (at most 30). Also counts as answering the prompt.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             maxItems: 30
 *             items:
 *               type: integer
 *     responses:
 *       200:
 *         description: The stored games
 *       400:
 *         description: Not an array of known game ids, or more than 30
 *       401:
 *         description: Not signed in
 *       403:
 *         description: Impersonating
 */
router.put('/games', async (req: Request, res: Response) => {
  try {
    const account = await resolveAccount(req, res, { write: true });
    if (!account) return;

    const body: unknown = req.body;
    if (
      !Array.isArray(body) ||
      !body.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)
    ) {
      return res
        .status(400)
        .json({ success: false, error: 'Body must be an array of game ids (positive integers)' });
    }
    const ids = [...new Set(body as number[])];
    if (ids.length > MAX_PLAYER_GAMES) {
      return res
        .status(400)
        .json({ success: false, error: `At most ${MAX_PLAYER_GAMES} games` });
    }

    await setPlayerGames(account.uid, ids);
    // Picked games are first in line for their app icons; never waited on.
    scheduleGameIconRefresh();
    return res.json(
      await gamesResponse({ ...account, gamesPromptDismissedAt: account.gamesPromptDismissedAt ?? 0 })
    );
  } catch (error) {
    if (error instanceof UnknownGameIdsError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    log.error('Error saving own games', error);
    return res.status(500).json({ success: false, error: 'Failed to save your games' });
  }
});

/**
 * @openapi
 * /api/me/games/prompt/dismiss:
 *   post:
 *     tags: [Me]
 *     summary: Skip the "What do you play?" prompt for this account
 *     responses:
 *       200:
 *         description: Dismissed
 *       401:
 *         description: Not signed in
 *       403:
 *         description: Impersonating
 */
router.post('/games/prompt/dismiss', async (req: Request, res: Response) => {
  try {
    const account = await resolveAccount(req, res, { write: true });
    if (!account) return;
    await dismissGamesPrompt(account.uid);
    return res.json({ success: true });
  } catch (error) {
    log.error('Error dismissing games prompt', error);
    return res.status(500).json({ success: false, error: 'Failed to skip' });
  }
});

// ---------------------------------------------------------------------------
// Connections: sign-in methods and game accounts
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  steam: 'Steam',
  discord: 'Discord',
  keycloak: 'Keycloak',
  github: 'GitHub',
  google: 'Google',
};

/** Providers this site can sign in with right now, with their labels. */
function enabledSignInProviders(): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of getAuthProvidersConfig()) {
    if (p.enabled) out.set(p.id, p.label);
  }
  return out;
}

async function connectionsResponse(account: PlayerAccount, isImpersonating: boolean) {
  const [player, identities] = await Promise.all([
    playerService.getPlayerById(account.steamId),
    authIdentityService.listIdentitiesForSteamId(account.steamId),
  ]);
  const enabled = enabledSignInProviders();
  const linkedProviders = identities.map((i) => i.provider);

  const signInMethods = [
    {
      provider: 'steam',
      label: PROVIDER_LABELS.steam,
      linked: true,
      primary: true,
      linkedAt: null as number | null,
      signInEnabled: enabled.has('steam'),
      canConnect: false,
      removable: false,
    },
  ];
  // Every provider this site offers, plus any linked one it no longer offers.
  const shown = LINKABLE_PROVIDERS.filter(
    (p) => enabled.has(p) || linkedProviders.includes(p)
  );
  for (const provider of shown) {
    const identity = identities.find((i) => i.provider === provider);
    signInMethods.push({
      provider,
      label: enabled.get(provider) ?? PROVIDER_LABELS[provider] ?? provider,
      linked: !!identity,
      primary: false,
      linkedAt: identity?.linkedAt ?? null,
      signInEnabled: enabled.has(provider),
      canConnect: !identity && enabled.has(provider),
      removable:
        !!identity &&
        checkRemoveSignInMethod({
          provider,
          linkedProviders,
          enabledProviders: [...enabled.keys()],
        }).ok,
    });
  }

  // Game accounts follow the installed game modules: each names the provider
  // whose account identifies its players.
  const gamesByProvider = new Map<string, Array<{ id: string; name: string }>>();
  for (const integration of listIntegrations()) {
    if (!integration.accountProvider) continue;
    const games = gamesByProvider.get(integration.accountProvider) ?? [];
    games.push({ id: integration.id, name: integration.displayName });
    gamesByProvider.set(integration.accountProvider, games);
  }
  const gameAccounts = [...gamesByProvider.entries()].map(([provider, games]) => ({
    provider,
    label: PROVIDER_LABELS[provider] ?? provider,
    // Steam is the account's own identity, proven by the Steam sign-in.
    linked: provider === 'steam',
    verified: provider === 'steam',
    externalId: provider === 'steam' ? account.steamId : null,
    games,
  }));

  return {
    success: true,
    account: {
      uid: account.uid,
      steamId: account.steamId,
      name: player?.name ?? account.steamId,
      avatar: player?.avatar ?? null,
    },
    isImpersonating,
    signInMethods,
    gameAccounts,
  };
}

/**
 * @openapi
 * /api/me/connections:
 *   get:
 *     tags: [Me]
 *     summary: The signed-in player's sign-in methods and game accounts
 *     description: >
 *       Sign-in methods list Steam (the account's primary identity, never
 *       removable) and every provider this site offers or the account has
 *       linked. Game accounts are derived from the installed game modules.
 *       Answers for the real signed-in account, also while impersonating.
 *     responses:
 *       200:
 *         description: Account, sign-in methods and game accounts
 *       401:
 *         description: Not signed in
 *       404:
 *         description: Signed in, but no player record
 */
router.get('/connections', async (req: Request, res: Response) => {
  try {
    const account = await resolveAccount(req, res, { write: false, what: 'account' });
    if (!account) return;
    const identity = await resolveViewerIdentity(req);
    return res.json(await connectionsResponse(account, identity.isImpersonating));
  } catch (error) {
    log.error('Error reading own connections', error);
    return res.status(500).json({ success: false, error: 'Failed to load your connections' });
  }
});

/**
 * @openapi
 * /api/me/connections/{provider}/remove:
 *   post:
 *     tags: [Me]
 *     summary: Remove a sign-in method from the signed-in player's account
 *     description: >
 *       Steam cannot be removed (it is the account's primary identity), and
 *       neither can the last method this site would let the player sign in
 *       with. Requires a JSON request from this site (Origin checked).
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [discord, keycloak, github, google]
 *     responses:
 *       200:
 *         description: Removed; the updated connections
 *       400:
 *         description: Steam, or not a sign-in provider
 *       401:
 *         description: Not signed in
 *       403:
 *         description: Impersonating, or a cross-site request
 *       404:
 *         description: Not linked to this account
 *       409:
 *         description: It is the last way to sign in
 *       415:
 *         description: Not a JSON request
 */
router.post('/connections/:provider/remove', async (req: Request, res: Response) => {
  try {
    if (!isSameSiteRequest(req)) {
      log.warn('Refused cross-site sign-in method removal', { provider: req.params.provider });
      return res.status(403).json({ success: false, error: 'Request refused' });
    }
    if (!req.is('application/json')) {
      return res.status(415).json({ success: false, error: 'Send this request as JSON' });
    }
    const account = await resolveAccount(req, res, { write: true, what: 'account' });
    if (!account) return;

    const { provider } = req.params;
    if (provider === 'steam') {
      return res
        .status(400)
        .json({ success: false, error: 'Steam is your primary sign-in and cannot be removed' });
    }
    if (!isLinkableProvider(provider)) {
      return res.status(400).json({ success: false, error: 'Unknown sign-in method' });
    }

    const identities = await authIdentityService.listIdentitiesForSteamId(account.steamId);
    const check = checkRemoveSignInMethod({
      provider,
      linkedProviders: identities.map((i) => i.provider),
      enabledProviders: [...enabledSignInProviders().keys()],
    });
    if (!check.ok) {
      if (check.reason === 'not_linked') {
        return res.status(404).json({ success: false, error: 'Not linked to your account' });
      }
      return res.status(409).json({
        success: false,
        error: 'This is your only way to sign in. Connect another method first.',
      });
    }

    await authIdentityService.unlinkProviderFromSteamId(provider, account.steamId);
    log.info('Removed sign-in method from account', { provider, steamId: account.steamId });
    return res.json(await connectionsResponse(account, false));
  } catch (error) {
    log.error('Error removing sign-in method', error);
    return res.status(500).json({ success: false, error: 'Failed to remove sign-in method' });
  }
});

export default router;
