/**
 * Settings -> Sign-in: set up Steam, Discord, Google, GitHub and Twitch
 * sign-in from the admin UI (Epic Games is listed as coming soon).
 *
 * Admin only (requireAuth). Writes are same-site JSON only, like the license
 * and catalog writes. A client secret is write-only: GET says whether one is
 * set, never what it is. Environment variables are only imported once at
 * boot (services/authProviderSettingsService). Saving re-registers the Passport strategies, so the change applies
 * without a restart.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requestActorId } from '../middleware/auth';
import { isSameSiteRequest } from '../utils/accountConnections';
import { log } from '../utils/logger';
import { getBackendBaseUrl, reloadPassportAuth } from '../config/passport';
import {
  isSignInProviderId,
  parseProviderPatch,
  signInProviderDefinition,
} from '../config/signInProviders';
import {
  authProviderSettingsService,
  EnvManagedFieldError,
} from '../services/authProviderSettingsService';
import { steamService } from '../services/steamService';
import { adminAccessSettings, AdminAccessError, parseAdminAccessPatch } from '../services/adminAccessSettings';
import { testSignInProvider } from '../services/signInProviderTest';

const router = Router();

router.use(requireAuth);

function refuseWrite(req: Request, res: Response): boolean {
  if (!isSameSiteRequest(req)) {
    res.status(403).json({ success: false, error: 'Request refused' });
    return true;
  }
  if (!req.is('application/json')) {
    res.status(415).json({ success: false, error: 'Send this request as JSON' });
    return true;
  }
  return false;
}

function listResponse() {
  return {
    success: true,
    providers: authProviderSettingsService.listForAdmin(getBackendBaseUrl()),
    // Which variable encrypts the saved secrets (utils/secretBox).
    secretsKeySource: authProviderSettingsService.keySource(),
  };
}

/**
 * @openapi
 * /api/sign-in-providers:
 *   get:
 *     tags: [Sign-in providers]
 *     summary: List the sign-in providers and how each is set up
 *     description: |
 *       Admin only. Per provider: enabled, client id, whether a secret is set
 *       (never the secret), the callback URL to register with the provider,
 *       and
 *       where to create the credentials. `secretsKeySource` names the
 *       variable the saved secrets are encrypted with (SECRETS_KEY, else
 *       SESSION_SECRET).
 *     responses:
 *       200:
 *         description: The providers
 *       401:
 *         description: Not signed in as an admin
 */
router.get('/', (_req: Request, res: Response) => {
  return res.json(listResponse());
});

/**
 * @openapi
 * /api/sign-in-providers/admin-access:
 *   get:
 *     tags: [Sign-in providers]
 *     summary: Admin access settings
 *     description: |
 *       Admin only. Whether local admin login (username + password) is on and
 *       whether it may be turned off, the admin Steam IDs (made admin at boot
 *       and on save) and the admin emails (admin at sign-in with a
 *       provider-verified address).
 *     responses:
 *       200:
 *         description: The settings
 *   put:
 *     tags: [Sign-in providers]
 *     summary: Change the admin access settings
 *     description: |
 *       Admin only; same-site JSON. Every field is optional. Local admin
 *       login can only be turned off while another admin can sign in with a
 *       provider that is on (409 otherwise).
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               localAdminLoginEnabled: { type: boolean }
 *               adminSteamIds: { type: string }
 *               adminEmails: { type: string }
 *     responses:
 *       200:
 *         description: Saved; the settings as GET returns them
 *       400:
 *         description: Invalid field
 *       409:
 *         description: Turning local admin login off would lock every admin out
 */
router.get('/admin-access', async (_req: Request, res: Response) => {
  return res.json({ success: true, ...(await adminAccessSettings.view()) });
});

router.put('/admin-access', async (req: Request, res: Response) => {
  if (refuseWrite(req, res)) return;
  const parsed = parseAdminAccessPatch(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
  try {
    await adminAccessSettings.update(parsed.patch, requestActorId(req));
    return res.json({ success: true, ...(await adminAccessSettings.view()) });
  } catch (error) {
    if (error instanceof AdminAccessError) return res.status(error.status).json({ success: false, error: error.message });
    log.error('[SIGN-IN] Failed to save admin access settings', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to save admin access settings' });
  }
});

/**
 * @openapi
 * /api/sign-in-providers/{provider}:
 *   put:
 *     tags: [Sign-in providers]
 *     summary: Change a sign-in provider's settings
 *     description: |
 *       Admin only; same-site JSON. Every field is optional. `clientSecret`
 *       replaces the saved secret (null clears it) and is stored encrypted.
 *       The
 *       sign-in strategies are re-registered at once; no restart.
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [steam, discord, google, github, twitch, epic]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               clientId: { type: string, nullable: true }
 *               clientSecret: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Saved; the providers as GET returns them
 *       400:
 *         description: Invalid field
 *       404:
 *         description: Unknown provider
 *       409:
 *         description: The provider is not available yet
 */
router.put('/:provider', async (req: Request, res: Response) => {
  if (refuseWrite(req, res)) return;
  const { provider } = req.params;
  if (!isSignInProviderId(provider)) {
    return res.status(404).json({ success: false, error: 'Unknown sign-in provider' });
  }
  const parsed = parseProviderPatch(signInProviderDefinition(provider), req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  try {
    await authProviderSettingsService.update(provider, parsed.patch, requestActorId(req));
    reloadPassportAuth();
    if (provider === 'steam') steamService.resetHealthCache();
    return res.json(listResponse());
  } catch (error) {
    if (error instanceof EnvManagedFieldError) {
      return res.status(409).json({ success: false, error: error.message });
    }
    log.error('[SIGN-IN] Failed to save sign-in settings', error as Error);
    return res.status(500).json({ success: false, error: 'Failed to save sign-in settings' });
  }
});

/**
 * @openapi
 * /api/sign-in-providers/{provider}/test:
 *   post:
 *     tags: [Sign-in providers]
 *     summary: Check a provider's credentials with the provider
 *     description: |
 *       Admin only; same-site JSON. Steam: a Web API call with the key.
 *       Discord, Twitch: a client-credentials token request. Google, GitHub:
 *       a code exchange with a code that cannot be valid, which tells a good
 *       client from a bad one. `result` is ok, invalid_credentials,
 *       unreachable, not_configured, not_supported or unexpected.
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The outcome
 *       404:
 *         description: Unknown provider
 */
router.post('/:provider/test', async (req: Request, res: Response) => {
  if (refuseWrite(req, res)) return;
  const { provider } = req.params;
  if (!isSignInProviderId(provider)) {
    return res.status(404).json({ success: false, error: 'Unknown sign-in provider' });
  }
  const callbackUrl = `${getBackendBaseUrl()}/api/auth/${provider}/callback`;
  const outcome = await testSignInProvider(provider, callbackUrl);
  log.info('[SIGN-IN] Provider test', { provider, result: outcome.result, actor: requestActorId(req) });
  return res.json({ success: true, ...outcome });
});

export default router;
