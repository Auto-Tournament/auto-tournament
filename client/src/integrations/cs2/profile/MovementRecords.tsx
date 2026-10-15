/**
 * Surf, bhop and kz records on the Leaderboards page (under the category
 * leaders): each player's best per map and course, from the servers that run
 * Ready Up's movement plugin (`movement.record`). Hidden until a server has
 * reported a run.
 */

import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, CircularProgress, MenuItem, TextField, Typography } from '@mui/material';
import {
  api,
  links,
  mono,
  PlayerAvatar,
  Row,
  RowList,
  SectionHead,
  SegmentedControl,
  textSize,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';

interface MovementMap {
  map: string;
  mode: 'surf' | 'bhop' | 'kz';
  courses: number[];
  players: number;
  lastAt: number;
  record: { playerId: string; name: string; timeMs: number } | null;
}

interface MovementRecord {
  rank: number;
  playerId: string;
  name: string;
  avatarUrl: string | null;
  timeMs: number;
  teleports: number;
  finishedAt: number;
  runs: number;
}

interface Board {
  total: number;
  records: MovementRecord[];
}

/** "1:02.345" / "12.345", like the plugin's chat. */
export function formatRunTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor(ms / 1000) % 60;
  const r = String(ms % 1000).padStart(3, '0');
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}.${r}` : `${s}.${r}`;
}

const keyOf = (m: Pick<MovementMap, 'map' | 'mode'>) => `${m.map}|${m.mode}`;

export function MovementRecords() {
  const { t, i18n } = useModuleTranslation('cs2');
  const [maps, setMaps] = useState<MovementMap[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [course, setCourse] = useState(0);
  const [loaded, setLoaded] = useState<{ query: string; board: Board | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ maps: MovementMap[] }>('/api/game/cs2/movement/maps')
      .then((r) => !cancelled && setMaps(r.maps ?? []))
      .catch(() => !cancelled && setMaps([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const current = maps?.find((m) => keyOf(m) === picked) ?? maps?.[0] ?? null;
  const courseNow = current?.courses.includes(course) ? course : (current?.courses[0] ?? 0);
  const query = current
    ? `map=${encodeURIComponent(current.map)}&mode=${current.mode}&course=${courseNow}`
    : null;

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    api
      .get<Board>(`/api/game/cs2/movement/records?${query}&limit=50`)
      .then((board) => !cancelled && setLoaded({ query, board }))
      .catch(() => !cancelled && setLoaded({ query, board: null }));
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (!maps || maps.length === 0 || !current) return null;
  const board = loaded?.query === query ? loaded.board : undefined;
  const kz = current.mode === 'kz';
  const columns = kz ? '3ch minmax(0, 1fr) 6.5rem 3.5rem 6rem' : '3ch minmax(0, 1fr) 6.5rem 6rem';
  const date = (s: number) =>
    new Date(s * 1000).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });

  return (
    <Box
      component="section"
      aria-labelledby="cs2-movement"
      data-testid="cs2-movement"
      sx={{ mt: 6 }}
    >
      <SectionHead id="cs2-movement" title={t('movement.title')} />
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
        <TextField
          select
          size="small"
          label={t('movement.map')}
          value={keyOf(current)}
          onChange={(e) => {
            setPicked(e.target.value);
            setCourse(0);
          }}
          sx={{ minWidth: 240, maxWidth: '100%' }}
          slotProps={{ htmlInput: { 'data-testid': 'cs2-movement-map' } }}
        >
          {maps.map((m) => (
            <MenuItem key={keyOf(m)} value={keyOf(m)}>
              <Box component="span" sx={{ ...mono }}>
                {m.map}
              </Box>
              <Box
                component="span"
                sx={{ ml: 1, color: tokens.color.muted, fontSize: textSize.sm }}
              >
                {t(`movement.mode.${m.mode}`)}
              </Box>
            </MenuItem>
          ))}
        </TextField>
        {current.courses.length > 1 && (
          <SegmentedControl<string>
            label={t('movement.course')}
            value={String(courseNow)}
            onChange={(v) => setCourse(Number(v))}
            options={current.courses.map((c) => ({
              value: String(c),
              label: c === 0 ? t('movement.mainCourse') : t('movement.bonus', { n: c }),
            }))}
            testId="cs2-movement-course"
          />
        )}
      </Box>
      <Typography
        sx={{ fontSize: textSize.sm, color: tokens.color.muted, mb: 2, maxWidth: '70ch' }}
      >
        {t('movement.explain')}
      </Typography>

      {board === undefined ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : !board || board.records.length === 0 ? (
        <Typography
          sx={{ fontSize: textSize.sm, color: tokens.color.muted }}
          data-testid="cs2-movement-empty"
        >
          {t('movement.empty')}
        </Typography>
      ) : (
        <RowList data-testid="cs2-movement-list">
          <Row columns={columns} sx={{ py: 1.25 }} aria-hidden>
            {[
              '#',
              t('leaderboards.player'),
              t('movement.time'),
              ...(kz ? [t('movement.teleports')] : []),
              t('movement.date'),
            ].map((h, i) => (
              <Typography
                key={h}
                sx={{
                  ...mono,
                  fontSize: textSize.xs,
                  color: tokens.color.muted,
                  textAlign: i >= 2 ? 'right' : 'left',
                }}
              >
                {h}
              </Typography>
            ))}
          </Row>
          {board.records.map((r) => (
            <Row key={r.playerId} columns={columns} data-testid="cs2-movement-row">
              <Typography
                sx={{
                  ...mono,
                  fontSize: textSize.sm,
                  color: r.rank <= 3 ? tokens.color.accent : tokens.color.muted,
                }}
              >
                {r.rank}
              </Typography>
              <Box
                component={RouterLink}
                to={links.playerProfile(r.playerId)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  minWidth: 0,
                  color: 'text.primary',
                  textDecoration: 'none',
                  '&:hover .name': { textDecoration: 'underline' },
                }}
              >
                <PlayerAvatar id={r.playerId} name={r.name} avatarUrl={r.avatarUrl} size={32} />
                <Typography className="name" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                  {r.name}
                </Typography>
              </Box>
              <Typography
                sx={{ ...mono, textAlign: 'right', fontWeight: 600 }}
                title={t('movement.runs', { count: r.runs })}
              >
                {formatRunTime(r.timeMs)}
              </Typography>
              {kz && (
                <Typography
                  sx={{
                    ...mono,
                    textAlign: 'right',
                    color: tokens.color.ink2,
                    fontSize: textSize.sm,
                  }}
                >
                  {r.teleports === 0 ? t('movement.pro') : r.teleports}
                </Typography>
              )}
              <Typography
                sx={{
                  ...mono,
                  textAlign: 'right',
                  color: tokens.color.ink2,
                  fontSize: textSize.sm,
                }}
              >
                {date(r.finishedAt)}
              </Typography>
            </Row>
          ))}
        </RowList>
      )}
    </Box>
  );
}
