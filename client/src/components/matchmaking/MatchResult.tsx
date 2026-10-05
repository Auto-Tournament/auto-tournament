/**
 * The post-match screen in the match room (docs/design/matchmaking.md, "After
 * the match"): map scores, the scoreboard with your row highlighted, your
 * rating change, the XP you got with your level bar, and thumbs up / down for
 * the others.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Chip,
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
import { tokens } from '../../theme/tokens';

interface Result {
  status: string | null;
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

export function MatchResult({ matchSlug }: { matchSlug: string }) {
  const { t } = useTranslation();
  const { playerSteamId } = useAuth();
  const { showError } = useSnackbar();
  const [result, setResult] = useState<Result | null>(null);
  const [downFor, setDownFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/matchmaking/matches/${encodeURIComponent(matchSlug)}/result`, { credentials: 'same-origin' });
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
      showError(apiErrorMessage(new Error(await res.text()), t('matchmaking.result.commendFailed')));
      return;
    }
    setDownFor(null);
    void load();
  };

  if (!result) return null;

  const given = new Map(result.commendsGiven.map((c) => [c.playerId, c]));
  const xpTotal = result.xp.reduce((n, x) => n + x.amount, 0);
  const ratingDelta = result.rating
    ? elo(result.rating.after, result.rating.sigmaAfter) - elo(result.rating.before, result.rating.sigmaBefore)
    : null;

  return (
    <Stack spacing={2} data-testid="mm-result">
      <Panel sx={{ p: 3 }}>
        <SectionHead title={t('matchmaking.result.title')} />
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          {result.maps.map((m, i) => (
            <Typography key={i} sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="mm-result-map">
              {m.map ?? t('matchmaking.result.map', { n: i + 1 })}: <strong>{m.team1}</strong> – <strong>{m.team2}</strong>
            </Typography>
          ))}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} mt={2}>
          {ratingDelta !== null && (
            <Box data-testid="mm-result-rating">
              <Typography variant="caption" color="text.secondary">
                {t('matchmaking.result.rating')}
              </Typography>
              <Typography sx={{ fontWeight: 700, color: ratingDelta >= 0 ? tokens.color.live : tokens.color.ban }}>
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
                <Chip key={x.reason} size="small" label={`${t(`matchmaking.result.xpReason.${x.reason}`)} +${x.amount}`} />
              ))}
            </Stack>
          </Box>
        </Stack>
      </Panel>

      {result.scoreboard.map((team) => (
        <Panel key={team.team} sx={{ p: { xs: 1, sm: 2 }, overflowX: 'auto' }}>
          <SectionHead title={t('matchmaking.room.team', { n: team.team })} />
          <Table size="small" aria-label={t('matchmaking.room.team', { n: team.team })}>
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
                              <ThumbsUpIcon size={18} weight={g?.value === 1 ? 'fill' : 'regular'} />
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
                                <ThumbsDownIcon size={18} weight={g?.value === -1 ? 'fill' : 'regular'} />
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
  );
}
