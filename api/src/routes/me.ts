/**
 * The signed-in player's own account data, keyed on the stable account id
 * (`players.uid`), not the Steam ID.
 *
 * Identity comes from the viewer-identity helpers: the *real* signed-in player.
 * An admin impersonating someone gets 403 on writes, like the Discord ID
 * self-service endpoints, because these answer for the session and an
 * impersonation should not quietly edit the other player's profile.
 */

import { installedPacks } from '../services/packCache';
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
import { db } from '../config/database';
import { localAdminService } from '../services/localAdminService';
import { adminAccessSettings } from '../services/adminAccessSettings';
import {
  SteamLinkError,
  connectSteamToLocalAccount,
  isSteamlessPlayerId,
} from '../services/localAccountSteamLink';
import { isLocalReauthFresh } from '../utils/localReauth';
import { clearPendingSteamMerge, readPendingSteamMerge, switchSessionAccount } from './auth';

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
  github: 'GitHub',
  google: 'Google',
  twitch: 'Twitch',
  epic: 'Epic Games',
  oidc: 'OpenID Connect',
  local: 'Admin login (username + password)',
};

/** Providers this site can sign in with right now, with their labels ('local' = the admin login). */
async function enabledSignInProviders(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of getAuthProvidersConfig()) {
    if (p.enabled) out.set(p.id, p.label);
  }
  if (await adminAccessSettings.isLocalAdminLoginEnabled()) out.set('local', PROVIDER_LABELS.local);
  return out;
}

interface SignInMethodRow {
  provider: string;
  label: string;
  linked: boolean;
  primary: boolean;
  linkedAt: number | null;
  signInEnabled: boolean;
  canConnect: boolean;
  removable: boolean;
  /** The local admin login's username. */
  username?: string;
  /** The connected account as its provider describes it. Shown to the owner only. */
  account?: { id: string; name: string | null; avatarUrl: string | null; email: string | null };
}

async function connectionsResponse(req: Request, account: PlayerAccount, isImpersonating: boolean) {
  const [player, identities, localLogin] = await Promise.all([
    playerService.getPlayerById(account.steamId),
    authIdentityService.listIdentitiesForSteamId(account.steamId),
    localAdminService.findByPlayerId(account.steamId),
  ]);
  const enabled = await enabledSignInProviders();
  const enabledIds = [...enabled.keys()];
  // A local admin account created on /setup has no Steam identity until it connects one.
  const hasSteam = !isSteamlessPlayerId(account.steamId);
  const linkedProviders = identities.map((i) => i.provider);
  if (localLogin) linkedProviders.push('local');
  const removable = (provider: string) =>
    checkRemoveSignInMethod({ provider, linkedProviders, enabledProviders: enabledIds, hasSteam }).ok;

  const signInMethods: SignInMethodRow[] = [];
  if (localLogin) {
    signInMethods.push({
      provider: 'local',
      label: PROVIDER_LABELS.local,
      linked: true,
      primary: false,
      linkedAt: null,
      signInEnabled: enabled.has('local'),
      canConnect: false,
      removable: removable('local'),
      username: localLogin.username,
    });
  }
  signInMethods.push({
    provider: 'steam',
    label: PROVIDER_LABELS.steam,
    linked: hasSteam,
    primary: hasSteam,
    linkedAt: null,
    signInEnabled: enabled.has('steam'),
    canConnect: !hasSteam && enabled.has('steam'),
    removable: false,
    ...(hasSteam && { account: { id: account.steamId, name: null, avatarUrl: null, email: null } }),
  });
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
      removable: !!identity && removable(provider),
      ...(identity && {
        account: {
          id: identity.providerUserId,
          name: identity.displayName,
          avatarUrl: identity.avatarUrl,
          email: identity.email,
        },
      }),
    });
  }

  // Game accounts follow the installed games: a module (CS2) or a pack
  // (Rocket League) names the provider whose account identifies its players.
  const gamesByProvider = new Map<string, Array<{ id: string; name: string }>>();
  const addGame = (provider: string, game: { id: string; name: string }) => {
    const games = gamesByProvider.get(provider) ?? [];
    if (!games.some((g) => g.id === game.id)) games.push(game);
    gamesByProvider.set(provider, games);
  };
  for (const integration of listIntegrations()) {
    if (integration.accountProvider) {
      addGame(integration.accountProvider, { id: integration.id, name: integration.displayName });
    }
  }
  for (const pack of installedPacks()) {
    if (pack.definition.account) addGame(pack.definition.account, { id: pack.slug, name: pack.name });
  }
  const gameAccounts = [...gamesByProvider.entries()].map(([provider, games]) => {
    // Steam is the account's own identity, proven by the Steam sign-in; any
    // other is a sign-in method linked to this account (signing in proved it).
    if (provider === 'steam') {
      return {
        provider,
        label: PROVIDER_LABELS[provider] ?? provider,
        linked: hasSteam,
        verified: hasSteam,
        externalId: hasSteam ? account.steamId : null,
        canConnect: !hasSteam && enabled.has('steam'),
        signInEnabled: enabled.has('steam'),
        games,
      };
    }
    const identity = identities.find((i) => i.provider === provider);
    return {
      provider,
      label: enabled.get(provider) ?? PROVIDER_LABELS[provider] ?? provider,
      linked: !!identity,
      verified: !!identity,
      externalId: identity?.providerUserId ?? null,
      canConnect: !identity && enabled.has(provider),
      signInEnabled: enabled.has(provider),
      ...(identity && {
        account: {
          id: identity.providerUserId,
          name: identity.displayName,
          avatarUrl: identity.avatarUrl,
          email: identity.email,
        },
      }),
      games,
    };
  });

  // Back from Steam with a Steam ID that already has a player: ask before merging.
  let pendingMerge: { steamId: string; name: string; avatar: string | null; matches: number } | null = null;
  const pending = !isImpersonating ? readPendingSteamMerge(req, account.steamId) : null;
  if (pending) {
    const steamPlayer = await playerService.getPlayerById(pending.steamId);
    if (steamPlayer) {
      const count = await db.queryOneAsync<{ n: string | number }>(
        'SELECT COUNT(DISTINCT match_slug) AS n FROM player_match_stats WHERE player_id = ?',
        [pending.steamId]
      );
      pendingMerge = {
        steamId: pending.steamId,
        name: steamPlayer.name,
        avatar: steamPlayer.avatar ?? null,
        matches: Number(count?.n ?? 0),
      };
    }
  }

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
    /** The account's local admin login, or null. `reauthFresh`: the password was confirmed in the last 10 minutes. */
    localLogin: localLogin
      ? {
          username: localLogin.username,
          totpEnabled: !!localLogin.totp_secret_enc,
          reauthFresh: isLocalReauthFresh(req, account.steamId),
        }
      : null,
    pendingMerge,
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
 *       removable), the local admin login when the account has one, and every
 *       provider this site offers or the account has linked. A local admin
 *       account created on /setup has no Steam identity until it connects
 *       one (`canConnect` on the Steam row). `pendingMerge` is set after
 *       Steam answered with a Steam ID that already has a player. Game
 *       accounts are derived from the installed game modules. Answers for
 *       the real signed-in account, also while impersonating.
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
    return res.json(await connectionsResponse(req, account, identity.isImpersonating));
  } catch (error) {
    log.error('Error reading own connections', error);
    return res.status(500).json({ success: false, error: 'Failed to load your connections' });
  }
});

/** Same-site JSON only (the CSRF rule of the account routes). Sends the refusal. */
function sameSiteJson(req: Request, res: Response, what: string): boolean {
  if (!isSameSiteRequest(req)) {
    log.warn(`Refused cross-site ${what}`, { provider: req.params.provider });
    res.status(403).json({ success: false, error: 'Request refused' });
    return false;
  }
  if (!req.is('application/json')) {
    res.status(415).json({ success: false, error: 'Send this request as JSON' });
    return false;
  }
  return true;
}

function reauthRequired(res: Response): Response {
  return res.status(403).json({
    success: false,
    reauthRequired: true,
    error: 'Confirm your admin password first',
  });
}

/**
 * @openapi
 * /api/me/connections/{provider}/remove:
 *   post:
 *     tags: [Me]
 *     summary: Remove a sign-in method from the signed-in player's account
 *     description: >
 *       Steam cannot be removed (it is the account's primary identity), and
 *       neither can the last method this site would let the player sign in
 *       with. `local` removes the account's admin login (username +
 *       password), and needs the password re-confirmed in the last 10
 *       minutes (`reauthRequired`). Requires a JSON request from this site
 *       (Origin checked).
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [discord, github, google, twitch, epic, oidc, local]
 *     responses:
 *       200:
 *         description: Removed; the updated connections
 *       400:
 *         description: Steam, or not a sign-in provider
 *       401:
 *         description: Not signed in
 *       403:
 *         description: Impersonating, a cross-site request, or `reauthRequired`
 *       404:
 *         description: Not linked to this account
 *       409:
 *         description: It is the last way to sign in
 *       415:
 *         description: Not a JSON request
 */
router.post('/connections/:provider/remove', async (req: Request, res: Response) => {
  try {
    if (!sameSiteJson(req, res, 'sign-in method removal')) return;
    const account = await resolveAccount(req, res, { write: true, what: 'account' });
    if (!account) return;

    const { provider } = req.params;
    const hasSteam = !isSteamlessPlayerId(account.steamId);
    if (provider === 'steam') {
      return res.status(400).json({
        success: false,
        error: hasSteam ? 'Steam is your primary sign-in and cannot be removed' : 'Not linked to your account',
      });
    }
    if (!isLinkableProvider(provider) && provider !== 'local') {
      return res.status(400).json({ success: false, error: 'Unknown sign-in method' });
    }

    const [identities, localLogin] = await Promise.all([
      authIdentityService.listIdentitiesForSteamId(account.steamId),
      localAdminService.findByPlayerId(account.steamId),
    ]);
    const linkedProviders = identities.map((i) => i.provider);
    if (localLogin) linkedProviders.push('local');
    const check = checkRemoveSignInMethod({
      provider,
      linkedProviders,
      enabledProviders: [...(await enabledSignInProviders()).keys()],
      hasSteam,
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

    if (provider === 'local') {
      if (!isLocalReauthFresh(req, account.steamId)) return reauthRequired(res);
      await db.queryAsync('DELETE FROM local_admins WHERE player_id = ?', [account.steamId]);
      log.warn('[AUDIT] Local admin login removed from account', {
        username: localLogin?.username,
        playerId: account.steamId,
      });
    } else {
      await authIdentityService.unlinkProviderFromSteamId(provider, account.steamId);
      log.info('Removed sign-in method from account', { provider, steamId: account.steamId });
    }
    return res.json(await connectionsResponse(req, account, false));
  } catch (error) {
    log.error('Error removing sign-in method', error);
    return res.status(500).json({ success: false, error: 'Failed to remove sign-in method' });
  }
});

/**
 * @openapi
 * /api/me/connections/steam/merge:
 *   post:
 *     tags: [Me]
 *     summary: Merge the Steam player waiting for confirmation into this local admin account
 *     description: >
 *       After connecting Steam answered with a Steam ID that already has a
 *       player (`pendingMerge` on GET /api/me/connections). The Steam player
 *       is kept (its id, matches and stats stay as they are) and becomes an
 *       admin; the local login and the sign-in methods of this account move
 *       onto it, and the local-* account is retired. This browser is then
 *       signed in as the Steam player. Same-site JSON; needs the password
 *       re-confirmed in the last 10 minutes. Audit-logged.
 *     responses:
 *       200:
 *         description: Merged; `steamId` is the account's id now
 *       403:
 *         description: Impersonating, a cross-site request, or `reauthRequired`
 *       404:
 *         description: No merge waiting (expired after 10 minutes)
 *       409:
 *         description: The Steam player has its own admin login, or changed in between
 */
router.post('/connections/steam/merge', async (req: Request, res: Response) => {
  try {
    if (!sameSiteJson(req, res, 'Steam merge')) return;
    const account = await resolveAccount(req, res, { write: true, what: 'account' });
    if (!account) return;
    const pending = readPendingSteamMerge(req, account.steamId);
    if (!pending) return res.status(404).json({ success: false, error: 'Nothing to merge. Connect Steam again.' });
    // Only an account with a local admin login has a password to re-confirm.
    if ((await localAdminService.findByPlayerId(account.steamId)) && !isLocalReauthFresh(req, account.steamId)) {
      return reauthRequired(res);
    }

    try {
      const result = await connectSteamToLocalAccount(account.steamId, pending.steamId, 'merge');
      clearPendingSteamMerge(req);
      log.warn('[AUDIT] Merged local admin account into existing Steam player; that player is now an admin', {
        from: account.steamId,
        steamId: pending.steamId,
        moved: result.moved,
      });
    } catch (error) {
      if (error instanceof SteamLinkError) {
        clearPendingSteamMerge(req);
        log.warn('[AUDIT] Steam merge refused', { from: account.steamId, steamId: pending.steamId, reason: error.reason });
        return res.status(409).json({
          success: false,
          error:
            error.reason === 'taken'
              ? 'That Steam account is already connected to another account'
              : 'The accounts changed in the meantime. Connect Steam again.',
        });
      }
      throw error;
    }
    await switchSessionAccount(req, res, pending.steamId);
    return res.json({ success: true, steamId: pending.steamId });
  } catch (error) {
    log.error('Error merging Steam player into local admin account', error);
    return res.status(500).json({ success: false, error: 'Failed to merge the accounts' });
  }
});

/**
 * @openapi
 * /api/me/connections/steam/merge/cancel:
 *   post:
 *     tags: [Me]
 *     summary: Drop the Steam merge waiting for confirmation
 *     responses:
 *       200:
 *         description: Dropped (or nothing was waiting)
 */
router.post('/connections/steam/merge/cancel', async (req: Request, res: Response) => {
  if (!sameSiteJson(req, res, 'Steam merge cancel')) return;
  clearPendingSteamMerge(req);
  return res.json({ success: true });
});

export default router;
