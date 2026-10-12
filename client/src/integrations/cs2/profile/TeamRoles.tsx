/**
 * The team page's roles: each roster player's chosen role, else the demos'
 * suggestion (marked as one, with how sure it is and why).
 */

import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Tooltip, Typography } from '@mui/material';
import {
  api,
  links,
  Panel,
  SectionHead,
  textSize,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';
import { useRoleText, type PlayerRoles } from './PlayerRole';

interface RosterName {
  id: string;
  name: string;
}

export function TeamRoles({ teamId }: { teamId: string }) {
  const { t } = useModuleTranslation('cs2');
  const text = useRoleText();
  const [loaded, setLoaded] = useState<{
    teamId: string;
    roles: Record<string, PlayerRoles>;
    names: RosterName[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ roles: Record<string, PlayerRoles> }>(
        `/api/game/cs2/teams/${encodeURIComponent(teamId)}/roles`
      ),
      api
        .get<{ players?: Array<{ id: string; name: string }> }>('/api/players/public-selection')
        .catch(() => ({ players: [] })),
    ])
      .then(([r, p]) => {
        if (cancelled) return;
        const ids = new Set(Object.keys(r.roles));
        setLoaded({
          teamId,
          roles: r.roles,
          names: (p.players ?? [])
            .filter((x) => ids.has(x.id))
            .map((x) => ({ id: x.id, name: x.name })),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const data = loaded?.teamId === teamId ? loaded : null;
  const rows = (data?.names ?? []).filter(
    (p) => data?.roles[p.id]?.chosen || data?.roles[p.id]?.suggestion
  );
  if (!data || rows.length === 0) return null;

  return (
    <Box component="section" aria-labelledby="cs2-team-roles" data-testid="cs2-team-roles">
      <SectionHead id="cs2-team-roles" title={t('roles.team')} />
      <Panel sx={{ p: 2, display: 'grid', gap: 1 }}>
        {rows.map((p) => {
          const r = data.roles[p.id];
          const s = r.suggestion;
          return (
            <Box
              key={p.id}
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 2,
                alignItems: 'baseline',
              }}
            >
              <Box
                component={RouterLink}
                to={links.playerProfile(p.id)}
                sx={{
                  color: 'text.primary',
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: textSize.sm,
                }}
              >
                {p.name}
              </Box>
              {r.chosen ? (
                <Typography sx={{ fontSize: textSize.sm }}>{text.label(r.chosen)}</Typography>
              ) : s ? (
                <Tooltip title={text.why(s)}>
                  <Typography sx={{ fontSize: textSize.sm, color: tokens.color.muted }}>
                    {t('roles.suggestedShort', {
                      role: text.label(s.role),
                      confidence: t(`roles.confidence.${s.confidence}`),
                    })}
                  </Typography>
                </Tooltip>
              ) : null}
            </Box>
          );
        })}
      </Panel>
    </Box>
  );
}
