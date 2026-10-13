/**
 * A game whose players need a sign-in that is turned off (CS2 needs Steam):
 * nobody can link the account the game identifies players by, so its
 * tournaments can't fill. Shown on Modules (every game) and in tournament
 * setup's Game step (the chosen game), with a link to Settings → Sign-in.
 */
import React from 'react';
import { Alert, Box, Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { SIGN_IN_SETTINGS_PATH } from '../../utils/signInSetup';

interface ModuleRow {
  id: string;
  name: string;
  status: string;
  accountProvider: string | null;
}

interface ProviderRow {
  id: string;
  label: string;
  enabled: boolean;
}

export interface SignInNeed {
  moduleId: string;
  game: string;
  provider: string;
}

/** Loaded modules whose required sign-in is off. */
export function useSignInNeeds(): SignInNeed[] {
  const [needs, setNeeds] = React.useState<SignInNeed[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ modules: ModuleRow[] }>('/api/modules'),
      api.get<{ providers: ProviderRow[] }>('/api/sign-in-providers'),
    ])
      .then(([m, p]) => {
        if (cancelled) return;
        const providers = new Map(p.providers.map((row) => [row.id, row]));
        setNeeds(
          m.modules.flatMap((row) => {
            if (row.status !== 'ok' || !row.accountProvider) return [];
            const provider = providers.get(row.accountProvider);
            if (!provider || provider.enabled) return [];
            return [{ moduleId: row.id, game: row.name, provider: provider.label }];
          })
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return needs;
}

/** The warning for every such game, or only `moduleId`'s. */
export function SignInNeedsWarning({ moduleId }: { moduleId?: string | null }) {
  const { t } = useTranslation();
  const needs = useSignInNeeds().filter((n) => moduleId === undefined || n.moduleId === moduleId);
  if (needs.length === 0) return null;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {needs.map((need) => (
        <Alert
          key={need.moduleId}
          severity="warning"
          data-testid={`sign-in-need-${need.moduleId}`}
          action={
            <Link component={RouterLink} to={SIGN_IN_SETTINGS_PATH} sx={{ whiteSpace: 'nowrap' }}>
              {t('modulesPage.signInNeed.action')}
            </Link>
          }
        >
          {t('modulesPage.signInNeed.body', { game: need.game, provider: need.provider })}
        </Alert>
      ))}
    </Box>
  );
}
