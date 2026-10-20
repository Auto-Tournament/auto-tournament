/**
 * ShuffleJoin's round views: the rounds timeline, this round's matches, a
 * match row and the admin's player list (moved out of ShuffleJoin.tsx).
 */
import React, { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { matchPagePath } from '../../../paths';
import { getMapDisplayName } from '../../../constants/maps';
import { fmtCountdown, fmtTime } from '../../../utils/time';
import { radii, tokens } from '../../../theme/tokens';
import {
  AvatarStack,
  MapTile,
  PlayerAvatar,
  SectionTitle,
  StatePill,
  YoursPill,
  panel,
} from '../ui/draftUi';
import type { ShufflePlayer } from '../../../hooks/useTournamentSignup';

const { color } = tokens;

export interface ShuffleRound {
  round: number | null;
  /** The rounds' maps in order (one map a round). */
  maps?: string[];
  finished?: boolean;
  matches: Array<{
    slug: string;
    status: string;
    teams: Array<{ name: string | null; steamIds: string[] }>;
  }>;
  sittingOut: string[];
  /** A break before this round: when it ends (epoch s); null when none. */
  breakUntil?: number | null;
}

/** Player names joined ("anna + bo"). */
type Names = (ids: string[]) => string;
/** Players as AvatarStack wants them. */
type Faces = (ids: string[]) => Array<{ id: string; name: string; avatar: string | null }>;

/** "Break · round 2 starts at 20:05 (4:12)", ticking every second while the break lasts. */
function BreakLine({ until, round }: { until: number; round: number }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (until * 1000 <= now) return null;
  return (
    <Box
      role="status"
      data-testid="shuffle-break"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 1,
        px: 2,
        py: 1.5,
        borderRadius: radii.md,
        bgcolor: color.paper3,
      }}
    >
      <Typography sx={{ fontWeight: 600 }}>
        {t('shuffleJoin.breakTitle', { round, time: fmtTime(until) })}
      </Typography>
      <Typography sx={{ fontVariantNumeric: 'tabular-nums', color: color.ink2 }}>
        {fmtCountdown(until, now)}
      </Typography>
    </Box>
  );
}

/** The rounds in a row, one map each: done, now, next, later. */
export function ShuffleTimeline({
  maps,
  roundNo,
  finished,
}: {
  maps: string[];
  roundNo: number | null;
  finished: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Box
      component="section"
      aria-labelledby="shuffle-rounds-title"
      data-testid="shuffle-timeline"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}
    >
      <SectionTitle
        id="shuffle-rounds-title"
        title={
          finished || roundNo === null
            ? t('shuffleJoin.roundsCount', { count: maps.length })
            : t('shuffleJoin.roundOf', { round: roundNo, total: maps.length })
        }
        note={t('shuffleOverview.oneMapPerRound')}
      />
      {/* One row of rounds; it scrolls sideways on a phone (no round alone on a last row). */}
      <Box
        component="ol"
        sx={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: { xs: '9.5rem', md: 'minmax(9rem, 1fr)' },
          overflowX: 'auto',
          pb: 0.5,
          gap: 1.5,
          m: 0,
          p: 0,
          listStyle: 'none',
        }}
      >
        {maps.map((map, index) => {
          const n = index + 1;
          const current = !finished && roundNo === n;
          const done = finished || (roundNo !== null && n < roundNo);
          const state = done
            ? 'done'
            : current
              ? 'now'
              : roundNo !== null && n === roundNo + 1
                ? 'next'
                : 'later';
          return (
            <Box
              component="li"
              key={`${n}-${map}`}
              aria-current={current ? 'step' : undefined}
              data-testid={current ? 'shuffle-timeline-current' : 'shuffle-timeline-map'}
            >
              <MapTile
                map={map}
                played={done}
                ring={current ? color.live : 'transparent'}
                top={
                  <>
                    <Box
                      component="span"
                      sx={{
                        px: 1,
                        py: 0.25,
                        borderRadius: radii.pill,
                        bgcolor: color.paper,
                        fontSize: '0.8125rem',
                      }}
                    >
                      {t('shuffleJoin.roundShort', { round: n })}
                    </Box>
                    <StatePill state={state} label={t(`liveOverview.state.${state}`)} />
                  </>
                }
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/** One match of a round: both teams, "vs", whether it is yours, its state. */
export function ShuffleMatchRow({
  m,
  done,
  mine,
  names,
  faces,
}: {
  m: ShuffleRound['matches'][number];
  done: boolean;
  mine: boolean;
  names: Names;
  faces: Faces;
}) {
  const { t } = useTranslation();
  const winnerSide = (m as { winner?: 0 | 1 | null }).winner;
  const side = (i: 0 | 1) => {
    const ids = m.teams[i]?.steamIds ?? [];
    const won = done && winnerSide === i;
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 0,
          justifyContent: i === 1 ? 'flex-end' : 'flex-start',
          textAlign: i === 1 ? 'right' : 'left',
        }}
      >
        <Box sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
          <AvatarStack players={faces(ids)} size={26} />
        </Box>
        <Box
          component="span"
          sx={{
            display: { xs: 'none', sm: 'inline' },
            fontWeight: won ? 700 : 600,
            color: color.ink,
            overflowWrap: 'anywhere',
          }}
        >
          {names(ids)}
        </Box>
      </Box>
    );
  };
  return (
    <Box
      key={m.slug}
      component={RouterLink}
      to={matchPagePath(m.slug)}
      data-testid="shuffle-round-match"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr) auto',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.75,
        borderRadius: radii.md,
        bgcolor: color.paper3,
        color: 'inherit',
        textDecoration: 'none',
        '&:hover': { filter: 'brightness(1.12)' },
      }}
    >
      {side(0)}
      <Box component="span" sx={{ color: color.muted, fontSize: '0.875rem' }}>
        {t('shuffleJoin.versus')}
      </Box>
      {side(1)}
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 1,
          minWidth: 56,
        }}
      >
        {mine && <YoursPill kind="match" />}
        <Typography
          component="span"
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            textAlign: 'right',
            color: m.status === 'live' ? color.live : color.ink2,
          }}
        >
          {t(
            `shuffleJoin.status.${m.status === 'live' ? 'live' : m.status === 'completed' ? 'done' : 'waiting'}`
          )}
        </Typography>
      </Box>
    </Box>
  );
}

/** This round: its map, a break, its matches, who sits out, then earlier rounds. */
export function ShuffleThisRound({
  round,
  roundNo,
  myMap,
  myMatchSlug,
  earlier,
  names,
  faces,
}: {
  round: ShuffleRound;
  roundNo: number;
  myMap: string | null;
  myMatchSlug: string | undefined;
  earlier?: React.ReactNode[];
  names: Names;
  faces: Faces;
}) {
  const { t } = useTranslation();
  return (
    <Box
      component="section"
      aria-labelledby="shuffle-this-round"
      data-testid="shuffle-round"
      sx={{ ...panel, flex: '999 1 520px' }}
    >
      <SectionTitle
        id="shuffle-this-round"
        title={`${t('shuffleJoin.roundHeading', { round: roundNo })}${myMap || round.maps?.[roundNo - 1] ? ` · ${getMapDisplayName((round.maps?.[roundNo - 1] ?? myMap) as string)}` : ''}`}
      />
      {round.breakUntil ? <BreakLine until={round.breakUntil} round={roundNo} /> : null}
      {round.matches.map((m) => (
        <ShuffleMatchRow
          key={m.slug}
          m={m}
          done={false}
          mine={m.slug === myMatchSlug}
          names={names}
          faces={faces}
        />
      ))}
      {round.sittingOut.length > 0 && (
        <Box
          data-testid="shuffle-round-sitting-out"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1,
            color: color.ink2,
            fontSize: '0.875rem',
          }}
        >
          <Box component="span" sx={{ color: color.muted }}>
            {t('shuffleOverview.sittingOut')}
          </Box>
          <Box sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
            <AvatarStack players={faces(round.sittingOut)} size={26} />
          </Box>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            {names(round.sittingOut).replace(/ \+ /g, ', ')}
          </Box>
          <Box component="span" sx={{ color: color.muted }}>
            · {t('shuffleOverview.firstNextRound')}
          </Box>
        </Box>
      )}
      {earlier && earlier.length > 0 && (
        <>
          <Box sx={{ height: '1px', bgcolor: color.rule, my: 0.5 }} />
          <Typography
            component="h3"
            sx={{
              m: 0,
              fontSize: '0.875rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: color.muted,
              fontWeight: 600,
            }}
          >
            {t('liveOverview.earlier')}
          </Typography>
          {earlier}
        </>
      )}
    </Box>
  );
}

/** The admin's player list while it runs: mark a player out (gone home) or back in. */
export function ShuffleAdminPlayers({
  players,
  sittingOut,
  marking,
  onMark,
}: {
  players: ShufflePlayer[];
  sittingOut: Set<string>;
  marking: string | null;
  onMark: (steamId: string, out: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Box component="section" aria-labelledby="shuffle-admin-players" sx={panel}>
      <SectionTitle
        id="shuffle-admin-players"
        title={t('shuffleOverview.players')}
        note={t('shuffleOverview.markOutHint')}
      />
      <Box
        component="ol"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
        }}
        data-testid="shuffle-players"
      >
        {players.map((p) => (
          <Box
            component="li"
            key={p.steamId}
            sx={{
              display: 'grid',
              gridTemplateColumns: '32px minmax(0,1fr) auto auto',
              gap: 1.5,
              alignItems: 'center',
              px: 1.5,
              py: 1,
              borderRadius: radii.sm,
              bgcolor: color.paper3,
            }}
          >
            <PlayerAvatar id={p.steamId} name={p.name} avatar={p.avatar} size={32} />
            <Typography
              component="span"
              sx={{ color: p.left ? color.muted : color.ink, overflowWrap: 'anywhere' }}
            >
              {p.name}
            </Typography>
            <Typography
              component="span"
              sx={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: p.left ? color.ban : sittingOut.has(p.steamId) ? color.muted : color.live,
              }}
            >
              {p.left
                ? p.leftReason === 'no_show'
                  ? t('shuffleJoin.tagNoShow')
                  : t('shuffleJoin.tagLeft')
                : sittingOut.has(p.steamId)
                  ? t('shuffleJoin.tagSittingOut')
                  : t('shuffleJoin.tagPlaying')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              disabled={marking === p.steamId}
              onClick={() => onMark(p.steamId, !p.left)}
              data-testid="shuffle-mark-out"
              sx={{ minHeight: 36, borderRadius: radii.pill }}
            >
              {p.left ? t('shuffleJoin.markIn') : t('shuffleJoin.markOut')}
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
