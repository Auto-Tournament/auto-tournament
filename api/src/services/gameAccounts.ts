/**
 * Which account identifies a game's players (Vikunja 1771): a code module
 * names its sign-in provider (`GameIntegration.accountProvider`: CS2 →
 * Steam), a pack its `account` (Rocket League → Epic Games). Games that name
 * none (manual reporting, games on several platforms) need no account.
 *
 * The admin's player and team forms ask for these accounts, not for a Steam
 * ID everywhere; /me/connections lists the same ones to the player.
 *
 * An account an admin enters for a player is kept unverified in
 * `linked_accounts` until its owner signs in with that provider, which lands
 * them on that player (routes/auth.ts) and marks it verified. Steam is the
 * player id itself, as before.
 */

import { db } from '../config/database';
import { listIntegrations } from '../integrations/registry';
import { isSignInProviderId } from '../config/signInProviders';
import { installedPacks } from './packCache';
import type { Untrusted } from '../utils/untrusted';

export const ACCOUNT_LABELS: Record<string, string> = {
  steam: 'Steam',
  discord: 'Discord',
  github: 'GitHub',
  google: 'Google',
  twitch: 'Twitch',
  epic: 'Epic Games',
  oidc: 'OpenID Connect',
};

export interface GameAccountProvider {
  provider: string;
  label: string;
  /** The installed games whose players it identifies. */
  games: { id: string; name: string }[];
}

/** The accounts the installed games need, each with its games (modules first, then packs). */
export function gameAccountProviders(): GameAccountProvider[] {
  const byProvider = new Map<string, GameAccountProvider>();
  const add = (provider: string, game: { id: string; name: string }) => {
    const entry = byProvider.get(provider) ?? {
      provider,
      label: ACCOUNT_LABELS[provider] ?? provider,
      games: [],
    };
    if (!entry.games.some((g) => g.id === game.id)) entry.games.push(game);
    byProvider.set(provider, entry);
  };
  for (const integration of listIntegrations()) {
    if (integration.accountProvider) {
      add(integration.accountProvider, { id: integration.id, name: integration.displayName });
    }
  }
  for (const pack of installedPacks()) {
    if (pack.definition.account) add(pack.definition.account, { id: pack.slug, name: pack.name });
  }
  return [...byProvider.values()];
}

/** The account a game needs (`cs2` → `steam`), or null for none. */
export function accountProviderFor(game: string | null | undefined): string | null {
  if (!game) return null;
  const key = game.trim().toLowerCase();
  return (
    gameAccountProviders().find((p) => p.games.some((g) => g.id.toLowerCase() === key))?.provider ??
    null
  );
}

export class PresetAccountError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** A provider an admin may preset for a player: a sign-in provider other than Steam (that is the id). */
export function isPresetProvider(provider: string): boolean {
  return provider !== 'steam' && isSignInProviderId(provider);
}

export interface PlayerAccount {
  provider: string;
  externalId: string;
  /** True once its owner signed in with it. */
  verified: boolean;
}

export const presetAccounts = {
  async list(playerId: string): Promise<PlayerAccount[]> {
    const rows = await db.queryAsync<{ provider: string; external_id: string; verified: boolean }>(
      "SELECT provider, external_id, verified FROM linked_accounts WHERE player_id = ? AND provider <> 'steam' ORDER BY provider",
      [playerId]
    );
    return rows.map((r) => ({
      provider: r.provider,
      externalId: r.external_id,
      verified: !!r.verified,
    }));
  },

  /**
   * Set (a string) or clear (null or '') the accounts an admin entered for a
   * player. A verified one (its owner signed in with it) is never changed or
   * removed here; one that belongs to another player is refused (409).
   */
  async set(playerId: string, accounts: Record<string, Untrusted>): Promise<void> {
    for (const [provider, raw] of Object.entries(accounts)) {
      if (!isPresetProvider(provider))
        throw new PresetAccountError(400, `Unknown account: ${provider}`);
      const value = typeof raw === 'string' ? raw.trim() : raw === null ? '' : undefined;
      if (value === undefined)
        throw new PresetAccountError(400, `${provider}: an account id or null`);
      if (value.length > 128 || /[\s<>]/.test(value)) {
        throw new PresetAccountError(
          400,
          `${ACCOUNT_LABELS[provider] ?? provider}: not an account id`
        );
      }
      const current = await db.queryOneAsync<{ external_id: string; verified: boolean }>(
        'SELECT external_id, verified FROM linked_accounts WHERE player_id = ? AND provider = ?',
        [playerId, provider]
      );
      if (current?.verified) {
        if (value === current.external_id) continue;
        throw new PresetAccountError(
          409,
          `${ACCOUNT_LABELS[provider] ?? provider}: the player signed in with this account; they change it themselves`
        );
      }
      if (!value) {
        await db.runAsync(
          'DELETE FROM linked_accounts WHERE player_id = ? AND provider = ? AND NOT verified',
          [playerId, provider]
        );
        continue;
      }
      if (current?.external_id === value) continue;
      const owner = await db.queryOneAsync<{ player_id: string }>(
        'SELECT player_id FROM linked_accounts WHERE provider = ? AND external_id = ?',
        [provider, value]
      );
      const identity = await db.queryOneAsync<{ steam_id: string }>(
        'SELECT steam_id FROM auth_identities WHERE provider = ? AND provider_user_id = ?',
        [provider, value]
      );
      if ((owner && owner.player_id !== playerId) || (identity && identity.steam_id !== playerId)) {
        throw new PresetAccountError(
          409,
          `${ACCOUNT_LABELS[provider] ?? provider}: that account belongs to another player`
        );
      }
      await db.runAsync(
        'DELETE FROM linked_accounts WHERE player_id = ? AND provider = ? AND NOT verified',
        [playerId, provider]
      );
      await db.runAsync(
        'INSERT INTO linked_accounts (player_id, provider, external_id, verified) VALUES (?, ?, ?, FALSE)',
        [playerId, provider, value]
      );
    }
  },

  /** The player an admin entered this account for (unverified), if any. */
  async findPreset(provider: string, externalId: string): Promise<string | null> {
    const row = await db.queryOneAsync<{ player_id: string }>(
      `SELECT la.player_id FROM linked_accounts la JOIN players p ON p.id = la.player_id
        WHERE la.provider = ? AND la.external_id = ? AND NOT la.verified
          AND p.deleted_at IS NULL AND p.banned_at IS NULL`,
      [provider, externalId]
    );
    return row?.player_id ?? null;
  },

  /** Its owner signed in with it: verified from now on. */
  async markVerified(provider: string, externalId: string): Promise<void> {
    await db.runAsync(
      'UPDATE linked_accounts SET verified = TRUE WHERE provider = ? AND external_id = ?',
      [provider, externalId]
    );
  },
};
