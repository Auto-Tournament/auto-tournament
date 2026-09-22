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
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { log } from '../utils/logger';

const router = Router();

async function resolveAccount(
  req: Request,
  res: Response,
  { write }: { write: boolean }
): Promise<PlayerAccount | null> {
  const identity = await resolveViewerIdentity(req);
  if (!identity.realSteamId) {
    res.status(401).json({ success: false, error: 'Sign in to manage your games' });
    return null;
  }
  if (write && identity.isImpersonating) {
    res.status(403).json({
      success: false,
      error: 'You are impersonating a player. Stop impersonating to manage your own games.',
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

export default router;
