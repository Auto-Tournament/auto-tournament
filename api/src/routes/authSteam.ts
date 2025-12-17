import { Router, Request, Response } from 'express';
import { log } from '../utils/logger';

const router = Router();

// Steam OpenID endpoint
const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const STEAM_OPENID_NS = 'http://specs.openid.net/auth/2.0';

function getBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol || 'http';
  const host = req.get('host');
  return `${proto}://${host}`;
}

/**
 * Start Steam OpenID login (players only)
 *
 * GET /api/auth/steam
 * Redirects the user to Steam's OpenID provider and then back to /api/auth/steam/callback.
 */
router.get('/steam', (req: Request, res: Response) => {
  try {
    const baseUrl = getBaseUrl(req);
    const returnTo = `${baseUrl}/api/auth/steam/callback`;
    const realm = baseUrl;

    const params = new URLSearchParams({
      'openid.ns': STEAM_OPENID_NS,
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': realm,
      'openid.identity': `${STEAM_OPENID_NS}/identifier_select`,
      'openid.claimed_id': `${STEAM_OPENID_NS}/identifier_select`,
    });

    const redirectUrl = `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
    return res.redirect(302, redirectUrl);
  } catch (error) {
    log.error('Failed to start Steam OpenID login', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to start Steam login',
    });
  }
});

/**
 * Steam OpenID callback
 *
 * GET /api/auth/steam/callback
 * Verifies the OpenID assertion with Steam and redirects the user to /player/:steamId.
 *
 * Note: This flow is intentionally "players only" – it does NOT grant any admin rights.
 * We use it purely as a convenience to jump a user to their player page.
 */
router.get('/steam/callback', async (req: Request, res: Response) => {
  try {
    // Steam sends all OpenID fields as query parameters
    const query = req.query as Record<string, string | string[] | undefined>;

    // Basic sanity check
    if (!query['openid.mode']) {
      return res.status(400).json({
        success: false,
        error: 'Missing OpenID response from Steam',
      });
    }

    // Prepare verification payload to Steam
    const verificationParams = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // Steam never sends arrays here, but handle defensively
        verificationParams.append(key, value[0]);
      } else if (value !== undefined) {
        verificationParams.append(key, value);
      }
    });

    // Per OpenID spec: switch mode to "check_authentication"
    verificationParams.set('openid.mode', 'check_authentication');

    const response = await fetch(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: verificationParams.toString(),
    });

    const body = await response.text();

    const isValid = body.includes('is_valid:true');
    if (!isValid) {
      log.warn('Steam OpenID assertion was not valid', { body });
      return res.status(400).json({
        success: false,
        error: 'Steam login could not be verified',
      });
    }

    // Extract Steam64 ID from claimed_id
    const claimedId =
      typeof query['openid.claimed_id'] === 'string'
        ? (query['openid.claimed_id'] as string)
        : undefined;

    if (!claimedId || !claimedId.includes('/openid/id/')) {
      log.warn('Steam OpenID callback missing claimed_id', { claimedId });
      return res.status(400).json({
        success: false,
        error: 'Steam ID could not be determined from login',
      });
    }

    const steamId = claimedId.split('/').pop();

    if (!steamId || !/^\d+$/.test(steamId)) {
      log.warn('Steam OpenID callback had invalid Steam ID component', { claimedId, steamId });
      return res.status(400).json({
        success: false,
        error: 'Steam ID format was invalid',
      });
    }

    log.success('Steam OpenID login verified', { steamId });

    // Optional: set a lightweight, non-privileged cookie for convenience.
    // This cookie is not used for authorization; it only lets the UI show a "My Profile" link.
    res.cookie('player_steam_id', steamId, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    });

    // Redirect player to their public profile page
    const baseUrl = getBaseUrl(req);
    const redirectTo = `${baseUrl}/app/player/${steamId}`;
    return res.redirect(302, redirectTo);
  } catch (error) {
    log.error('Steam OpenID callback failed', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Steam login failed',
    });
  }
});

/**
 * Lightweight "who am I" endpoint for players.
 * This is not a security boundary; it only reflects the player_steam_id cookie.
 */
router.get('/me', (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
      cookieHeader
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [name, ...rest] = part.split('=');
          return [name, decodeURIComponent(rest.join('='))];
        })
    );

    const steamId = cookies.player_steam_id;

    if (!steamId) {
      return res.json({
        authenticated: false,
      });
    }

    return res.json({
      authenticated: true,
      steamId,
    });
  } catch (error) {
    log.warn('Failed to read player_steam_id cookie', error as Error);
    return res.json({
      authenticated: false,
    });
  }
});

export default router;
