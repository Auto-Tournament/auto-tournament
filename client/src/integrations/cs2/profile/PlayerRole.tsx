/**
 * A player's role on their profile: the one they chose, else the demos'
 * suggestion with how sure it is and why. On their own profile a player
 * picks it (a pick is never changed by new demos).
 */

import { useEffect, useState } from 'react';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import {
  api,
  apiErrorMessage,
  Panel,
  SectionHead,
  textSize,
  tokens,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';

export const ROLES = ['rifler', 'awper', 'igl', 'entry', 'support', 'lurker'] as const;
export type Role = (typeof ROLES)[number];

export interface RoleSuggestion {
  role: Role;
  confidence: 'low' | 'medium' | 'high';
  evidence: {
    maps: number;
    rounds: number;
    kills: number;
    awpShare: number;
    openingRate: number;
    flashesPerRound: number;
    utilityPerRound: number;
  };
}

export interface PlayerRoles {
  chosen: Role | null;
  suggestion: RoleSuggestion | null;
}

/** "Suggested: AWPer (medium, 8 maps)" and why, for a tooltip or a line. */
export function useRoleText() {
  const { t } = useModuleTranslation('cs2');
  return {
    label: (role: Role) => t(`teamPositions.${role}`, { defaultValue: role }),
    why: (s: RoleSuggestion) => {
      const e = s.evidence;
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      return s.role === 'awper'
        ? t('roles.why.awper', { share: pct(e.awpShare) })
        : s.role === 'entry'
          ? t('roles.why.entry', { share: pct(e.openingRate) })
          : s.role === 'support'
            ? t('roles.why.support', { flashes: e.flashesPerRound, utility: e.utilityPerRound })
            : t('roles.why.rifler');
    },
  };
}

export function PlayerRole({ playerId, isOwn }: { playerId: string; isOwn: boolean }) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const text = useRoleText();
  const [loaded, setLoaded] = useState<{ playerId: string; roles: PlayerRoles } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<PlayerRoles>(`/api/game/cs2/players/${encodeURIComponent(playerId)}/role`)
      .then(
        (r) =>
          !cancelled &&
          setLoaded({ playerId, roles: { chosen: r.chosen, suggestion: r.suggestion } })
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [playerId]);
  const roles = loaded?.playerId === playerId ? loaded.roles : null;
  if (!roles || (!roles.chosen && !roles.suggestion && !isOwn)) return null;

  const choose = async (role: Role | null) => {
    try {
      const r = await api.put<PlayerRoles>('/api/game/cs2/players/me/role', { role });
      setLoaded({ playerId, roles: { chosen: r.chosen, suggestion: r.suggestion } });
    } catch (error) {
      showError(apiErrorMessage(error, t('roles.saveFailed')));
    }
  };

  const s = roles.suggestion;
  return (
    <Box component="section" aria-labelledby="cs2-role" data-testid="cs2-player-role">
      <SectionHead id="cs2-role" title={t('roles.title')} />
      <Panel sx={{ p: 2.5, display: 'grid', gap: 1.5 }}>
        {isOwn ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: textSize.sm }}>{t('roles.yours')}</Typography>
            <Select
              size="small"
              value={roles.chosen ?? ''}
              displayEmpty
              onChange={(e) => void choose((e.target.value as Role) || null)}
              inputProps={{ 'aria-label': t('roles.yours') }}
              data-testid="cs2-role-select"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">{t('roles.none')}</MenuItem>
              {ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {text.label(r)}
                </MenuItem>
              ))}
            </Select>
          </Box>
        ) : roles.chosen ? (
          <Typography sx={{ fontWeight: 600 }} data-testid="cs2-role-chosen">
            {text.label(roles.chosen)}
          </Typography>
        ) : null}
        {s ? (
          <Typography
            sx={{ fontSize: textSize.sm, color: tokens.color.ink2 }}
            data-testid="cs2-role-suggestion"
          >
            {t('roles.suggested', {
              role: text.label(s.role),
              confidence: t(`roles.confidence.${s.confidence}`),
              maps: s.evidence.maps,
            })}{' '}
            <Box component="span" sx={{ color: tokens.color.muted }}>
              {text.why(s)}
            </Box>
          </Typography>
        ) : (
          <Typography sx={{ fontSize: textSize.sm, color: tokens.color.muted }}>
            {t('roles.noSuggestion')}
          </Typography>
        )}
      </Panel>
    </Box>
  );
}
