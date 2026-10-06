import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import {
  api,
  mono,
  Panel,
  SectionHead,
  textSize,
  tokens,
  useModuleTranslation,
  withAlpha,
} from '../../../module-sdk';
import type { TeamProfileViewProps } from '../../types';
import { getMapDisplayName } from '../maps/mapData';
import { MapRadar, mapStrength, type MapResult } from './MapRadar';

interface TeamProfileResponse {
  success: boolean;
  maps: MapResult[];
  veto: {
    count: number;
    mostBanned: { map: string; count: number } | null;
    mostPicked: { map: string; count: number } | null;
  };
}

/**
 * The CS2 part of a team's page (`teamProfileView`): the team's map
 * strength radar, its best and weakest map, and the maps it bans and picks
 * most in the veto. Renders nothing until the team has a CS2 map on record.
 */
export function Cs2TeamProfileStats({ teamId }: TeamProfileViewProps) {
  const { t } = useModuleTranslation('cs2');
  const [loaded, setLoaded] = useState<{ teamId: string; data: TeamProfileResponse } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<TeamProfileResponse>(`/api/game/cs2/teams/${encodeURIComponent(teamId)}/profile`)
      .then((res) => {
        if (!cancelled && res.success) setLoaded({ teamId, data: res });
      })
      .catch(() => {
        // The rest of the team page still shows.
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const data = loaded?.teamId === teamId ? loaded.data : null;
  const ranked = (data?.maps ?? [])
    .filter((m) => m.played > 0)
    .map((m) => ({ ...m, strength: mapStrength(m) }))
    .sort((a, b) => b.strength - a.strength);
  if (!data || ranked.length === 0) return null;

  const best = ranked.length >= 2 ? ranked[0] : null;
  const weakest = ranked.length >= 2 ? ranked[ranked.length - 1] : null;
  const line = (tone: string, label: string, value: string) => (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 2,
        px: 1.5,
        py: 1,
        borderRadius: 1,
        bgcolor: withAlpha(tone, 0.1),
      }}
    >
      <Box component="span" sx={{ color: tone, fontWeight: 600 }}>
        {label}
      </Box>
      <Box component="span" sx={{ fontFamily: mono, color: tokens.color.ink2 }}>
        {value}
      </Box>
    </Box>
  );

  return (
    <Box component="section" aria-labelledby="cs2-team-maps" data-testid="cs2-team-profile">
      <SectionHead id="cs2-team-maps" title={t('profile.maps')} />
      <Panel sx={{ p: 2.5, display: 'grid', gap: 2 }}>
        {ranked.length >= 3 ? (
          <MapRadar maps={data.maps} label={t('profile.teamMapsAria')} />
        ) : (
          <Typography sx={{ fontSize: textSize.sm, color: tokens.color.muted }}>
            {t('profile.teamMapsFew')}
          </Typography>
        )}
        <Box sx={{ display: 'grid', gap: 1, fontSize: textSize.sm }}>
          {best &&
            line(
              tokens.color.pick,
              t('profile.best', { map: getMapDisplayName(best.map) }),
              t('profile.mapSummary', {
                pct: Math.round((best.won / best.played) * 100),
                played: best.played,
              })
            )}
          {weakest &&
            line(
              tokens.color.ban,
              t('profile.weakest', { map: getMapDisplayName(weakest.map) }),
              t('profile.mapSummary', {
                pct: Math.round((weakest.won / weakest.played) * 100),
                played: weakest.played,
              })
            )}
          {data.veto.mostBanned && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 1.5 }}>
              <Box component="span" sx={{ color: tokens.color.ink2 }}>
                {t('profile.bansMost')}
              </Box>
              <Box component="span" sx={{ fontFamily: mono, color: tokens.color.ink2 }}>
                {t('profile.vetoShare', {
                  map: getMapDisplayName(data.veto.mostBanned.map),
                  count: data.veto.mostBanned.count,
                  total: data.veto.count,
                })}
              </Box>
            </Box>
          )}
          {data.veto.mostPicked && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 1.5 }}>
              <Box component="span" sx={{ color: tokens.color.ink2 }}>
                {t('profile.picksMost')}
              </Box>
              <Box component="span" sx={{ fontFamily: mono, color: tokens.color.ink2 }}>
                {t('profile.vetoShare', {
                  map: getMapDisplayName(data.veto.mostPicked.map),
                  count: data.veto.mostPicked.count,
                  total: data.veto.count,
                })}
              </Box>
            </Box>
          )}
        </Box>
      </Panel>
    </Box>
  );
}
