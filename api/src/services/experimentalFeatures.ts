import type { NextFunction, Request, Response } from 'express';
import { isTruthySetting } from '../utils/settingFields';
import { settingsService, type CoreSettingKey } from './settingsService';

/**
 * Experimental features: work in progress that ships dark.
 *
 * Each feature is off by default. An admin turns it on under Settings →
 * Experimental (an `app_settings` row), or a developer sets its environment
 * variable. The variable wins over the stored setting, both ways:
 * `EXPERIMENTAL_MATCHMAKING=1` turns matchmaking on, `=0` keeps it off.
 *
 * While a feature is off, none of it is reachable: its routes answer 404
 * (`requireExperimentalFeature`) and the client shows none of it.
 */

export interface ExperimentalFeature {
  id: string;
  /** The `app_settings` key that stores the admin's choice. */
  settingKey: CoreSettingKey;
  /** The environment variable that overrides the stored choice. */
  env: string;
}

export const EXPERIMENTAL_FEATURES = [
  {
    id: 'matchmaking',
    settingKey: 'experimental_matchmaking',
    env: 'EXPERIMENTAL_MATCHMAKING',
  },
] as const satisfies ReadonlyArray<ExperimentalFeature>;

export type ExperimentalFeatureId = (typeof EXPERIMENTAL_FEATURES)[number]['id'];

export interface ExperimentalFeatureState {
  id: ExperimentalFeatureId;
  enabled: boolean;
  /** Where `enabled` came from. `env`: the admin toggle has no effect. */
  source: 'env' | 'setting' | 'default';
  env: string;
}

export function findExperimentalFeature(id: string): ExperimentalFeature | undefined {
  return EXPERIMENTAL_FEATURES.find((feature) => feature.id === id);
}

/** Pure: the feature's state from its stored setting and the environment. */
export function resolveExperimentalFeature(
  feature: ExperimentalFeature,
  stored: string | null,
  env: NodeJS.ProcessEnv
): Omit<ExperimentalFeatureState, 'id'> & { id: string } {
  const fromEnv = env[feature.env]?.trim();
  if (fromEnv) {
    return { id: feature.id, enabled: isTruthySetting(fromEnv), source: 'env', env: feature.env };
  }
  if (stored?.trim()) {
    return {
      id: feature.id,
      enabled: isTruthySetting(stored.trim()),
      source: 'setting',
      env: feature.env,
    };
  }
  return { id: feature.id, enabled: false, source: 'default', env: feature.env };
}

export async function getExperimentalFeature(
  id: ExperimentalFeatureId
): Promise<ExperimentalFeatureState> {
  const feature = findExperimentalFeature(id)!;
  const stored = await settingsService.getSetting(feature.settingKey);
  return resolveExperimentalFeature(feature, stored, process.env) as ExperimentalFeatureState;
}

export async function isExperimentalFeatureEnabled(id: ExperimentalFeatureId): Promise<boolean> {
  return (await getExperimentalFeature(id)).enabled;
}

export async function listExperimentalFeatures(): Promise<ExperimentalFeatureState[]> {
  return Promise.all(EXPERIMENTAL_FEATURES.map((feature) => getExperimentalFeature(feature.id)));
}

export async function setExperimentalFeature(
  id: ExperimentalFeatureId,
  enabled: boolean
): Promise<ExperimentalFeatureState> {
  const feature = findExperimentalFeature(id)!;
  await settingsService.setSetting(feature.settingKey, enabled ? '1' : '0');
  return getExperimentalFeature(id);
}

/**
 * Route guard: 404 while the feature is off, as if the route did not exist.
 * Mount it before any auth check, so an anonymous caller learns nothing
 * either.
 */
export function requireExperimentalFeature(id: ExperimentalFeatureId) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (await isExperimentalFeatureEnabled(id)) return next();
    } catch {
      // A settings read that fails counts as off.
    }
    res.status(404).json({ success: false, error: 'Not found' });
  };
}
