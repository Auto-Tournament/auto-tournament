/**
 * The post-match screen in the match room (docs/design/matchmaking.md, "After
 * the match"): map scores, the scoreboard with your row highlighted, your
 * rating change, the XP you got with your level bar, and thumbs up / down for
 * the others.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { ThumbsDownIcon, ThumbsUpIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Panel, SectionHead } from '../common/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { apiErrorMessage } from '../../utils/api';
import { fontDisplay, tokens } from '../../theme/tokens';

interface Result {
  status: string | null;
  myTeam?: number | null;
  durationSeconds?: number | null;
  maps: Array<{ map: string | null; team1: number; team2: number; winner: string | null }>;
  scoreboard: Array<{
    team: number;
    players: Array<{
      id: string;
      name: string;
      kills: number | null;
      deaths: number | null;
      assists: number | null;
      adr: number | null;
      hsPercent: number | null;
      mvps: number | null;
    }>;
  }>;
  rating: { before: number; after: number; sigmaBefore: number; sigmaAfter: number } | null;
  xp: Array<{ reason: string; amount: number }>;
  progress: { level: number; totalXp: number; intoLevel: number; forNext: number };
  commendsGiven: Array<{ playerId: string; value: number; tag: string | null }>;
}

const DOWN_TAGS = ['toxic', 'griefing', 'afk', 'other'] as const;

/** Display Elo from OpenSkill (utils/ratingMath on the API: ordinal × 200 + 1500). */
const elo = (mu: number, sigma: number) => Math.round((mu - 3 * sigma) * 200 + 1500);

export function MatchResult({ matchSlug, modeLabel }: { matchSlug: string; modeLabel?: string }) {
  const { t } = useTranslation();
  const { playerSteamId } = useAuth();
  const { showError } = useSnackbar();
  const [result, setResult] = useState<Result | null>(null);
  const [downFor, setDownFor] = useState<string | null>(null);
  const [fullBoard, setFullBoard] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/matchmaking/matches/${encodeURIComponent(matchSlug)}/result`, {
      credentials: 'same-origin',
    });
    if (res.ok) setResult(((await res.json()) as { result: Result }).result);
  }, [matchSlug]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  const commend = async (playerId: string, value: 1 | -1, tag?: string) => {
    const res = await fetch(
      `/api/matchmaking/matches/${encodeURIComponent(matchSlug)}/commends/${encodeURIComponent(playerId)}`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, tag }),
      }
    );
    if (!res.ok) {
      showError(
        apiErrorMessage(new Error(await res.text()), t('matchmaking.result.commendFailed'))
      );
      return;
    }
    setDownFor(null);
    void load();
  };

  if (!result) return null;

  const given = new Map(result.commendsGiven.map((c) => [c.playerId, c]));
  const xpTotal = result.xp.reduce((n, x) => n + x.amount, 0);
  const ratingDelta = result.rating
    ? elo(result.rating.after, result.rating.sigmaAfter) -
      elo(result.rating.before, result.rating.sigmaBefore)
    : null;

  // Won, lost or drew, from your side: maps won against maps lost.
  const mine = result.myTeam ?? null;
  const mapsWon = result.maps.filter((m) => (mine === 1 ? m.team1 > m.team2 : m.team2 > m.team1)).length;
  const mapsLost = result.maps.filter((m) => (mine === 1 ? m.team1 < m.team2 : m.team2 < m.team1)).length;
  const outcome = mine === null || result.maps.length === 0 ? null : mapsWon > mapsLost ? 'win' : mapsWon < mapsLost ? 'loss' : 'draw';
  const outcomeColor = outcome === 'win' ? tokens.color.pick : outcome === 'loss' ? tokens.color.ban : tokens.color.ink2;
  const scoreLine = result.maps
    .map((m) => (mine === 2 ? `${m.team2} – ${m.team1}` : `${m.team1} – ${m.team2}`))
    .join(', ');
  const meRow = result.scoreboard.flatMap((team) => team.players).find((p) => p.id === playerSteamId);
  const minutes = result.durationSeconds ? Math.round(result.durationSeconds / 60) : null;
  const facts = [
    result.maps.map((m, i) => m.map ?? t('matchmaking.result.map', { n: i + 1 })).join(', '),
    modeLabel,
    minutes ? t('matchmaking.result.minutes', { count: minutes }) : null,
  ].filter(Boolean);
  const tiles = meRow
    ? [
        { label: 'K / D / A', value: `${meRow.kills ?? '–'} / ${meRow.deaths ?? '–'} / ${meRow.assists ?? '–'}` },
        { label: 'ADR', value: meRow.adr !== null ? String(Math.round(meRow.adr)) : '–' },
        { label: 'HS%', value: meRow.hsPercent !== null ? `${meRow.hsPercent}%` : '–' },
        { label: 'MVP', value: meRow.mvps !== null ? String(meRow.mvps) : '–' },
      ]
    : [];

  return (
    <Stack spacing={2} data-testid="mm-result">
      <Panel sx={{ p: 3 }}>
        {outcome && (
          <Box sx={{ mb: 2 }} data-testid="mm-result-outcome">
            <Typography
              component="h2"
              sx={{ m: 0, fontFamily: fontDisplay, fontWeight: 700, fontSize: { xs: '2.25rem', md: '3rem' }, letterSpacing: '0.02em', lineHeight: 1, color: outcomeColor }}
            >
              {t(`matchmaking.result.outcome.${outcome}`)}
            </Typography>
            <Typography sx={{ mt: 0.75, fontFamily: fontDisplay, fontSize: '1.5rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {scoreLine}
            </Typography>
            <Typography sx={{ color: tokens.color.muted }}>{facts.join(' · ')}</Typography>
          </Box>
        )}
        {!outcome && (
          <>
            <SectionHead title={t('matchmaking.result.title')} />
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              {result.maps.map((m, i) => (
                <Typography key={i} sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="mm-result-map">
                  {m.map ?? t('matchmaking.result.map', { n: i + 1 })}: <strong>{m.team1}</strong> – <strong>{m.team2}</strong>
                </Typography>
              ))}
            </Stack>
          </>
        )}

        {tiles.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {t('matchmaking.result.yourGame')}
            </Typography>
            <Box
              data-testid="mm-result-your-game"
              sx={{ mt: 0.75, display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}
            >
              {tiles.map((tile) => (
                <Box key={tile.label} sx={{ p: 1.5, borderRadius: '14px', bgcolor: tokens.color.paper3 }}>
                  <Typography sx={{ fontSize: '0.75rem', color: tokens.color.muted }}>{tile.label}</Typography>
                  <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{tile.value}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} mt={2}>
          {ratingDelta !== null && (
            <Box data-testid="mm-result-rating">
              <Typography variant="caption" color="text.secondary">
                {t('matchmaking.result.rating')}
              </Typography>
              <Typography
                sx={{
                  fontWeight: 700,
                  color: ratingDelta >= 0 ? tokens.color.live : tokens.color.ban,
                }}
              >
                {ratingDelta >= 0 ? '+' : ''}
                {ratingDelta}
              </Typography>
            </Box>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }} data-testid="mm-result-xp">
            <Typography variant="caption" color="text.secondary">
              {t('matchmaking.result.xp', { xp: xpTotal, level: result.progress.level })}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(result.progress.intoLevel / result.progress.forNext) * 100}
              aria-label={t('matchmaking.result.levelProgress', {
                into: result.progress.intoLevel,
                next: result.progress.forNext,
              })}
              sx={{ height: 8, borderRadius: 4, my: 0.5 }}
            />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {result.xp.map((x) => (
                <Chip
                  key={x.reason}
                  size="small"
                  label={`${t(`matchmaking.result.xpReason.${x.reason}`)} +${x.amount}`}
                />
              ))}
            </Stack>
          </Box>
        </Stack>
        <Button
          onClick={() => setFullBoard((v) => !v)}
          aria-expanded={fullBoard}
          data-testid="mm-result-full-board"
          sx={{ mt: 2, px: 0, textTransform: 'none' }}
        >
          {fullBoard ? t('matchmaking.result.hideBoard') : t('matchmaking.result.fullBoard')}
        </Button>
      </Panel>

      <Collapse in={fullBoard} unmountOnExit>
      <Stack spacing={2}>
      {result.scoreboard.map((team) => (
        <Panel key={team.team} sx={{ p: { xs: 1, sm: 2 }, overflowX: 'auto' }}>
          <SectionHead title={t('matchmaking.room.teamLetter', { letter: team.team === 1 ? 'A' : 'B' })} />
          <Table size="small" aria-label={t('matchmaking.room.teamLetter', { letter: team.team === 1 ? 'A' : 'B' })}>
            <TableHead>
              <TableRow>
                <TableCell>{t('matchmaking.result.player')}</TableCell>
                <TableCell align="right">K</TableCell>
                <TableCell align="right">D</TableCell>
                <TableCell align="right">A</TableCell>
                <TableCell align="right">ADR</TableCell>
                <TableCell align="right">HS%</TableCell>
                <TableCell align="right">MVP</TableCell>
                <TableCell align="right">{t('matchmaking.result.commend')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {team.players.map((p) => {
                const mine = p.id === playerSteamId;
                const g = given.get(p.id);
                return (
                  <TableRow key={p.id} selected={mine} data-testid={`mm-row-${p.id}`}>
                    <TableCell sx={{ fontWeight: mine ? 700 : 400 }}>{p.name}</TableCell>
                    <TableCell align="right">{p.kills ?? '–'}</TableCell>
                    <TableCell align="right">{p.deaths ?? '–'}</TableCell>
                    <TableCell align="right">{p.assists ?? '–'}</TableCell>
                    <TableCell align="right">{p.adr !== null ? Math.round(p.adr) : '–'}</TableCell>
                    <TableCell align="right">{p.hsPercent ?? '–'}</TableCell>
                    <TableCell align="right">{p.mvps ?? '–'}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {!mine && result.status === 'completed' && (
                        <>
                          <Tooltip title={t('matchmaking.result.thumbsUp')}>
                            <IconButton
                              size="small"
                              aria-label={t('matchmaking.result.thumbsUpFor', { name: p.name })}
                              aria-pressed={g?.value === 1}
                              color={g?.value === 1 ? 'primary' : 'default'}
                              onClick={() => void commend(p.id, 1)}
                              data-testid={`mm-up-${p.id}`}
                            >
                              <ThumbsUpIcon
                                size={18}
                                weight={g?.value === 1 ? 'fill' : 'regular'}
                              />
                            </IconButton>
                          </Tooltip>
                          {downFor === p.id ? (
                            <Select
                              size="small"
                              value=""
                              displayEmpty
                              autoFocus
                              open
                              onClose={() => setDownFor(null)}
                              onChange={(e) => void commend(p.id, -1, String(e.target.value))}
                              inputProps={{ 'aria-label': t('matchmaking.result.downReason') }}
                              sx={{ minWidth: 120 }}
                            >
                              <MenuItem value="" disabled>
                                {t('matchmaking.result.downReason')}
                              </MenuItem>
                              {DOWN_TAGS.map((tag) => (
                                <MenuItem key={tag} value={tag}>
                                  {t(`matchmaking.result.downTag.${tag}`)}
                                </MenuItem>
                              ))}
                            </Select>
                          ) : (
                            <Tooltip title={t('matchmaking.result.thumbsDown')}>
                              <IconButton
                                size="small"
                                aria-label={t('matchmaking.result.thumbsDownFor', { name: p.name })}
                                aria-pressed={g?.value === -1}
                                color={g?.value === -1 ? 'error' : 'default'}
                                onClick={() => setDownFor(p.id)}
                                data-testid={`mm-down-${p.id}`}
                              >
                                <ThumbsDownIcon
                                  size={18}
                                  weight={g?.value === -1 ? 'fill' : 'regular'}
                                />
                              </IconButton>
                            </Tooltip>
                          )}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      ))}
      </Stack>
      </Collapse>
    </Stack>
  );
}
