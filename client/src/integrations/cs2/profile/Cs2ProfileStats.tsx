import { useEffect, useState, type ReactNode } from 'react';
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
import type { PlayerProfileViewProps } from '../../types';
import { getMapDisplayName } from '../maps/mapData';
import { MapRadar, mapStrength, type MapResult } from './MapRadar';

interface Totals {
  matches: number;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  totalDamage: number;
  roundsPlayed: number;
  flashAssists: number;
  utilityDamage: number;
  mvps: number;
  kast: number | null;
}

interface ProfileResponse {
  success: boolean;
  player: Totals;
  everyone: Totals;
  maps: MapResult[];
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/**
 * The CS2 part of a player's profile (`playerProfileView`): aim, utility and
 * impact against everyone's average, and how the player does on each map.
 * Renders nothing until the player has a CS2 match on record.
 */
export function Cs2ProfileStats({ playerId }: PlayerProfileViewProps) {
  const { t } = useModuleTranslation('cs2');
  // Keyed by player, so another profile never shows this one's numbers.
  const [loaded, setLoaded] = useState<{ playerId: string; data: ProfileResponse } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ProfileResponse>(`/api/game/cs2/players/${encodeURIComponent(playerId)}/profile`)
      .then((res) => {
        if (!cancelled && res.success) setLoaded({ playerId, data: res });
      })
      .catch(() => {
        // The profile's own facts still show; this part is extra.
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const data = loaded?.playerId === playerId ? loaded.data : null;
  if (!data) return null;
  // No CS2 match yet: the same tiles with dashes, so the profile keeps its shape.
  if (data.player.matches === 0) {
    return (
      <Box component="section" aria-labelledby="cs2-profile-stats" data-testid="cs2-profile-stats-empty" sx={{ mt: 6 }}>
        <SectionHead id="cs2-profile-stats" title={t('profile.title')} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
            gap: 1.5,
          }}
        >
          {[t('profile.kd'), t('profile.headshots'), t('profile.adr'), t('profile.impact')].map((label) => (
            <Panel key={label} sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5, borderStyle: 'dashed' }}>
              <Label>{label}</Label>
              <Big>—</Big>
            </Panel>
          ))}
        </Box>
        <Small>{t('profile.noMatchesYet')}</Small>
      </Box>
    );
  }
  const { player, everyone, maps } = data;

  const kd = ratio(player.kills, player.deaths) ?? player.kills;
  const hsPct = ratio(player.headshots, player.kills);
  const adr = ratio(player.totalDamage, player.roundsPlayed);
  const avgAdr = ratio(everyone.totalDamage, everyone.roundsPlayed);
  const avgHsPct = ratio(everyone.headshots, everyone.kills);
  const flashPerMatch = player.flashAssists / player.matches;
  const utilPerRound = ratio(player.utilityDamage, player.roundsPlayed);

  const ranked = maps
    .filter((m) => m.played > 0)
    .map((m) => ({ ...m, strength: mapStrength(m) }))
    .sort((a, b) => b.strength - a.strength);
  const best = ranked.length >= 2 ? ranked[0] : null;
  const weakest = ranked.length >= 2 ? ranked[ranked.length - 1] : null;

  return (
    <Box
      component="section"
      aria-labelledby="cs2-profile-stats"
      data-testid="cs2-profile-stats"
      sx={{ mt: 6 }}
    >
      <SectionHead id="cs2-profile-stats" title={t('profile.title')} />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(4, minmax(0, 1fr))',
          },
          gap: 1.5,
        }}
      >
        <Panel
          sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}
          data-testid="cs2-profile-kd"
        >
          <Label>{t('profile.kd')}</Label>
          <Big>{kd.toFixed(2)}</Big>
          <SplitBar
            left={player.kills}
            right={player.deaths}
            leftLabel={t('profile.kills', { count: player.kills })}
            rightLabel={t('profile.deaths', { count: player.deaths })}
          />
        </Panel>

        <Panel
          sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}
          data-testid="cs2-profile-hs"
        >
          <Ring value={hsPct ?? 0} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
            <Label>{t('profile.headshots')}</Label>
            <Big>{hsPct === null ? '—' : `${Math.round(hsPct * 100)}%`}</Big>
            {avgHsPct !== null && (
              <Small>{t('profile.average', { value: `${Math.round(avgHsPct * 100)}%` })}</Small>
            )}
          </Box>
        </Panel>

        <Panel
          sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}
          data-testid="cs2-profile-adr"
        >
          <Label>{t('profile.adr')}</Label>
          <Big>{adr === null ? '—' : adr.toFixed(1)}</Big>
          {adr !== null && avgAdr !== null && (
            <>
              <MarkerBar value={adr} marker={avgAdr} max={Math.max(150, adr, avgAdr)} />
              <Small>{t('profile.average', { value: avgAdr.toFixed(1) })}</Small>
            </>
          )}
        </Panel>

        <Panel
          sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}
          data-testid="cs2-profile-impact"
        >
          <Label>{t('profile.impact')}</Label>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
            <Fact value={player.kast === null ? '—' : `${Math.round(player.kast)}%`} label="KAST" />
            <Fact value={String(player.mvps)} label={t('profile.mvps')} />
            <Fact value={flashPerMatch.toFixed(1)} label={t('profile.flashAssists')} />
            <Fact
              value={utilPerRound === null ? '—' : utilPerRound.toFixed(1)}
              label={t('profile.utilityDamage')}
            />
          </Box>
        </Panel>
      </Box>

      {ranked.length > 0 && (
        <Panel
          sx={{
            mt: 1.5,
            p: 3,
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 460px) minmax(0, 1fr)' },
            gap: 4,
            alignItems: 'center',
          }}
          data-testid="cs2-profile-maps"
        >
          {ranked.length >= 3 ? (
            <MapRadar maps={maps} label={t('profile.mapsAria')} />
          ) : (
            <Small>{t('profile.mapsFew')}</Small>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <Typography component="h3" sx={{ fontWeight: 600, fontSize: textSize.lg }}>
              {t('profile.maps')}
            </Typography>
            {best && (
              <MapLine
                tone={tokens.color.pick}
                label={t('profile.best', { map: getMapDisplayName(best.map) })}
                map={best}
              />
            )}
            {weakest && (
              <MapLine
                tone={tokens.color.ban}
                label={t('profile.weakest', { map: getMapDisplayName(weakest.map) })}
                map={weakest}
              />
            )}
            <Box
              component="ul"
              sx={{
                listStyle: 'none',
                m: 0,
                p: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
              }}
            >
              {ranked.map((m) => (
                <Box
                  component="li"
                  key={m.map}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 2,
                    fontSize: textSize.sm,
                  }}
                >
                  <Box component="span" sx={{ color: tokens.color.ink2 }}>
                    {getMapDisplayName(m.map)}
                  </Box>
                  <Box component="span" sx={{ fontFamily: mono, color: tokens.color.muted }}>
                    {t('profile.mapRecord', {
                      won: m.won,
                      played: m.played,
                      rounds: `${m.roundsWon}–${m.roundsLost}`,
                    })}
                  </Box>
                </Box>
              ))}
            </Box>
            <Small>{t('profile.mapsNote')}</Small>
          </Box>
        </Panel>
      )}
    </Box>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: textSize.sm, color: tokens.color.muted }}>{children}</Typography>
  );
}

function Big({ children }: { children: ReactNode }) {
  return (
    <Typography
      sx={{
        fontWeight: 700,
        fontSize: '2.25rem',
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </Typography>
  );
}

function Small({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: textSize.xs, color: tokens.color.muted }}>{children}</Typography>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
      <Typography
        sx={{ fontWeight: 700, fontSize: textSize.lg, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
      <Small>{label}</Small>
    </Box>
  );
}

function SplitBar({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: number;
  right: number;
  leftLabel: string;
  rightLabel: string;
}) {
  const total = left + right;
  const share = total > 0 ? (left / total) * 100 : 50;
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          height: 8,
          borderRadius: 999,
          overflow: 'hidden',
          bgcolor: tokens.color.paper3,
        }}
        aria-hidden
      >
        <Box sx={{ width: `${share}%`, bgcolor: tokens.color.pick }} />
        <Box sx={{ flex: 1, bgcolor: tokens.color.ban }} />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.75 }}>
        <Small>{leftLabel}</Small>
        <Small>{rightLabel}</Small>
      </Box>
    </Box>
  );
}

function MarkerBar({ value, marker, max }: { value: number; marker: number; max: number }) {
  return (
    <Box
      sx={{ position: 'relative', height: 8, borderRadius: 999, bgcolor: tokens.color.paper3 }}
      aria-hidden
    >
      <Box
        sx={{
          width: `${Math.min(100, (value / max) * 100)}%`,
          height: 8,
          borderRadius: 999,
          bgcolor: tokens.color.accent,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: `${Math.min(100, (marker / max) * 100)}%`,
          top: -4,
          width: 2,
          height: 16,
          bgcolor: tokens.color.ink2,
        }}
      />
    </Box>
  );
}

function Ring({ value }: { value: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <Box
      component="svg"
      viewBox="0 0 76 76"
      sx={{ width: 76, height: 76, flex: 'none' }}
      aria-hidden
    >
      <circle cx="38" cy="38" r={r} fill="none" stroke={tokens.color.paper3} strokeWidth="8" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke={tokens.color.accent}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${c * Math.max(0, Math.min(1, value))} ${c}`}
        transform="rotate(-90 38 38)"
      />
    </Box>
  );
}

function MapLine({ tone, label, map }: { tone: string; label: string; map: MapResult }) {
  const { t } = useModuleTranslation('cs2');
  const pct = Math.round((map.won / map.played) * 100);
  return (
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
        {t('profile.mapSummary', { pct, played: map.played })}
      </Box>
    </Box>
  );
}
