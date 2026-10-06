import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Match } from '../../../types';
import { getMapDisplayName } from '../../../constants/maps';
import { getBracketMatchLabel, getMatchBracket, getRoundLabel } from '../../../utils/matchUtils';
import { tokens, fontDisplay, mono, radii } from '../../../theme/tokens';

const { color } = tokens;

type Tone = 'live' | 'veto' | 'done' | 'next';

/**
 * The public Bracket tab's bracket (tournament drafts, board 8): every match
 * as a card with its live state inside, round by round, the rounds joined by
 * bracket lines. A live match says which map and how far in; one in its veto
 * says so; one still to come names where its teams come from. Single
 * elimination puts a third-place match under the final; double elimination
 * shows the upper bracket, the lower bracket, then the grand final.
 */
export function CardBracket({
  matches,
  tournamentType,
  format,
}: {
  matches: Match[];
  tournamentType: string;
  format: string;
}) {
  const { t } = useTranslation();
  const bestOf = Number(format.replace(/\D/g, '')) || 1;

  const label = (m: Match, rounds: number): string => {
    const de = getBracketMatchLabel(m);
    if (de) return de;
    const roundMatches = matches.filter((x) => x.round === m.round && !getMatchBracket(x));
    const base = getRoundLabel(m.round, rounds);
    return roundMatches.length > 1 ? `${base} ${m.matchNumber}` : base;
  };

  if (tournamentType === 'double_elimination') {
    const upper = matches.filter((m) => getMatchBracket(m) === 'WB');
    const lower = matches.filter((m) => getMatchBracket(m) === 'LB');
    const finals = matches.filter((m) => ['GF', 'GF_RESET'].includes(getMatchBracket(m) ?? ''));
    return (
      <Box data-testid="card-bracket" sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Section title={t('bracketCards.upper')} matches={upper} all={matches} label={(m) => label(m, 0)} bestOf={bestOf} />
        <Section title={t('bracketCards.lower')} matches={lower} all={matches} label={(m) => label(m, 0)} bestOf={bestOf} />
        <Section title={t('bracketCards.grandFinal')} matches={finals} all={matches} label={(m) => label(m, 0)} bestOf={bestOf} />
      </Box>
    );
  }

  const rounds = Math.max(0, ...matches.map((m) => m.round));
  // A third-place match shares the final round with the final.
  const finalRound = matches.filter((m) => m.round === rounds).sort((a, b) => a.matchNumber - b.matchNumber);
  const third = finalRound.length > 1 ? finalRound.slice(1) : [];
  const main = matches.filter((m) => !third.includes(m));
  return (
    <Box data-testid="card-bracket">
      <Rounds
        matches={main}
        all={matches}
        label={(m) => label(m, rounds)}
        bestOf={bestOf}
        extra={
          third.length > 0 ? (
            <Box sx={{ mt: 3 }}>
              {third.map((m) => (
                <MatchCard key={m.id} match={m} all={matches} heading={t('bracketCards.thirdPlace')} bestOf={bestOf} muted />
              ))}
            </Box>
          ) : null
        }
      />
    </Box>
  );
}

function Section({
  title,
  matches,
  all,
  label,
  bestOf,
}: {
  title: string;
  matches: Match[];
  all: Match[];
  label: (m: Match) => string;
  bestOf: number;
}) {
  if (matches.length === 0) return null;
  return (
    <Box component="section" aria-label={title}>
      <Typography component="h3" sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.0625rem', mb: 1.5 }}>
        {title}
      </Typography>
      <Rounds matches={matches} all={all} label={label} bestOf={bestOf} />
    </Box>
  );
}

/** Columns of rounds; each pair of matches feeding one is joined by a bracket line. */
function Rounds({
  matches,
  all,
  label,
  bestOf,
  extra,
}: {
  matches: Match[];
  all: Match[];
  label: (m: Match) => string;
  bestOf: number;
  extra?: ReactNode;
}) {
  const roundNumbers = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  return (
    <Box sx={{ overflowX: 'auto', pb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0, minWidth: 'min-content' }}>
        {roundNumbers.map((round, index) => {
          const inRound = matches.filter((m) => m.round === round).sort((a, b) => a.matchNumber - b.matchNumber);
          const last = index === roundNumbers.length - 1;
          return (
            <Box key={round} sx={{ display: 'flex', alignItems: 'stretch' }}>
              <Box sx={{ width: 280, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 3 }}>
                {inRound.map((m) => (
                  <MatchCard key={m.id} match={m} all={all} heading={label(m)} bestOf={bestOf} />
                ))}
                {last ? extra : null}
              </Box>
              {!last && (
                <Box aria-hidden sx={{ width: 40, display: 'flex', flexDirection: 'column', justifyContent: 'space-around' }}>
                  {Array.from({ length: Math.max(1, Math.ceil(inRound.length / 2)) }, (_, i) => (
                    <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <Box
                        sx={{
                          height: inRound.length > 1 ? '50%' : 0,
                          width: 20,
                          border: `2px solid ${color.rule}`,
                          borderLeft: 'none',
                          borderRadius: '0 12px 12px 0',
                          borderTopWidth: inRound.length > 1 ? 2 : 0,
                        }}
                      />
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function toneOf(m: Match): Tone {
  if (m.status === 'live' || m.status === 'loaded') return 'live';
  if (m.vetoing) return 'veto';
  if (m.status === 'completed') return 'done';
  return 'next';
}

/** One match: what stage it is, the two teams with the series score, and what it is doing now. */
function MatchCard({
  match,
  all,
  heading,
  bestOf,
  muted = false,
}: {
  match: Match;
  all: Match[];
  heading: string;
  bestOf: number;
  muted?: boolean;
}) {
  const { t } = useTranslation();
  const tone = toneOf(match);
  const toneColor = tone === 'live' ? color.live : tone === 'veto' ? color.accent : muted ? color.muted : color.rule;
  const feeders = all.filter((m) => m.nextMatchId === match.id).sort((a, b) => a.matchNumber - b.matchNumber);
  const winnerId = match.winner?.id;
  const statusText =
    tone === 'live'
      ? t('bracketCards.live')
      : tone === 'veto'
        ? t('bracketCards.veto')
        : tone === 'done'
          ? t('bracketCards.done')
          : '';

  const footer =
    tone === 'live'
      ? [
          match.currentMap ? getMapDisplayName(match.currentMap).toUpperCase() : null,
          typeof match.team1MapScore === 'number' && typeof match.team2MapScore === 'number'
            ? `${match.team1MapScore}–${match.team2MapScore}`
            : null,
          bestOf > 1 && typeof match.mapNumber === 'number' ? t('bracketCards.mapOf', { n: match.mapNumber + 1, total: bestOf }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : tone === 'veto'
        ? t('bracketCards.banning')
        : tone === 'done'
          ? (match.mapResults ?? [])
              .map((r) => `${r.mapName ? getMapDisplayName(r.mapName) : ''} ${r.team1Score}–${r.team2Score}`.trim())
              .join(' · ')
          : t('bracketCards.bestOf', { count: bestOf });

  const row = (team: Match['team1'], score: number | undefined, slot: 0 | 1) => {
    const from = feeders[slot];
    const won = winnerId !== undefined && team?.id === winnerId;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1.25, borderTop: slot === 1 ? `1px solid ${color.rule}` : 'none' }}>
        {team ? (
          <>
            <Box
              component="span"
              sx={{ flex: 'none', width: 32, height: 32, borderRadius: '8px', bgcolor: color.paper3, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '0.625rem', color: color.ink2 }}
            >
              {(team.tag || team.name.slice(0, 3)).slice(0, 4).toUpperCase()}
            </Box>
            <Typography sx={{ flex: 1, minWidth: 0, fontWeight: won ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {team.name}
            </Typography>
            <Typography sx={{ ...mono, fontSize: '1rem', fontWeight: 600, color: won || tone === 'live' ? color.ink : color.muted }}>
              {typeof score === 'number' ? score : ''}
            </Typography>
          </>
        ) : (
          <Typography sx={{ color: color.muted, fontSize: '0.875rem' }}>
            {from ? t(muted ? 'bracketCards.loserOf' : 'bracketCards.winnerOf', { match: shortLabel(from, all) }) : t('bracketCards.tbd')}
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid={`card-bracket-match-${match.id}`} data-tone={tone}>
      <Typography sx={{ ...mono, fontSize: '0.6875rem', color: tone === 'live' ? color.live : tone === 'veto' ? color.accent : color.muted, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {heading}
        {statusText && ' · '}
        {tone === 'live' && <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color.live }} />}
        {statusText}
      </Typography>
      <Box
        sx={{
          color: color.ink,
          borderRadius: radii.md,
          bgcolor: color.paper2,
          border: `1px solid ${toneColor}`,
          overflow: 'hidden',
        }}
      >
        {row(match.team1, match.team1SeriesScore ?? match.team1Score, 0)}
        {row(match.team2, match.team2SeriesScore ?? match.team2Score, 1)}
        {footer && (
          <Typography sx={{ ...mono, px: 1.75, py: 1, borderTop: `1px solid ${color.rule}`, fontSize: '0.75rem', color: color.muted, textTransform: 'uppercase' }}>
            {footer}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/** "Semi-final 1", for "Winner of …" on a slot still to be decided. */
function shortLabel(match: Match, all: Match[]): string {
  const de = getBracketMatchLabel(match);
  if (de) return de;
  const rounds = Math.max(0, ...all.map((m) => m.round));
  const sameRound = all.filter((m) => m.round === match.round);
  const base = getRoundLabel(match.round, rounds);
  return sameRound.length > 1 ? `${base} ${match.matchNumber}` : base;
}
