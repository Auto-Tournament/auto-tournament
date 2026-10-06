import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Box, ButtonBase, CircularProgress, Container, Typography } from '@mui/material';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import {
  api,
  fontDisplay,
  mono,
  pageTitle,
  Panel,
  radii,
  SectionHead,
  textSize,
  tokens,
  useModuleTranslation,
  withAlpha,
} from '../../../module-sdk';
import { getMapDisplayName } from '../maps/mapData';

const { color } = tokens;

type Side = 'CT' | 'T';
type TeamKey = 'team1' | 'team2';

interface Round {
  number: number;
  startTick: number;
  endTick: number;
  winner: Side | null;
  reason: string | null;
  ctEquipment?: number;
  tEquipment?: number;
}

interface Kill {
  tick: number;
  round: number;
  attacker: string | null;
  victim: string;
  assister: string | null;
  weapon: string;
  headshot: boolean;
  penetrated?: boolean;
  throughSmoke?: boolean;
  attackerSide: Side | null;
  victimSide: Side | null;
  opening: boolean;
  trade: boolean;
  traded: boolean;
}

interface PlayerLine {
  id: string;
  name: string;
  team: TeamKey;
  rating: number | null;
  kills: number;
  deaths: number;
  assists: number;
  adr: number | null;
  kast: number | null;
  headshotPct: number | null;
  openingKills: number;
  openingDeaths: number;
  tradeKills: number;
  clutchesWon: number;
  clutchesPlayed: number;
  multiKills: number[];
  moneySpent: number;
  accuracy: number | null;
  crosshairDegrees: number | null;
  timeToDamageMs: number | null;
}

interface AnalysisResponse {
  status: string;
  map: string | null;
  rounds: Round[];
  kills: Kill[];
  players: PlayerLine[];
}

const TICKRATE = 64;

/**
 * A team's buy from its average equipment value at freeze end: no standard
 * exists, so these are ours (under $1,000 eco, under $3,500 force, else full);
 * the first round of each half is the pistol round.
 */
function buyType(
  round: Round,
  equipment: number | undefined,
  players: number
): 'pistol' | 'eco' | 'force' | 'full' | null {
  if (round.number === 1 || round.number === 13) return 'pistol';
  if (equipment === undefined || players === 0) return null;
  const avg = equipment / players;
  return avg < 1000 ? 'eco' : avg < 3500 ? 'force' : 'full';
}

/** mm:ss into the round. */
function clock(ticks: number): string {
  const s = Math.max(0, Math.round(ticks / TICKRATE));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * One map's demo, read after the match by the worker: the score and every
 * round (winner, how it ended, each side's buy), the round's kills with
 * openings and trades marked, and each player's numbers.
 */
export function DemoAnalysisPage() {
  const { matchSlug = '', mapNumber = '0' } = useParams();
  const { t } = useModuleTranslation('cs2');
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(1);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AnalysisResponse>(
        `/api/game/cs2/matches/${encodeURIComponent(matchSlug)}/maps/${Number(mapNumber)}/analysis`
      )
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [matchSlug, mapNumber]);

  const mapName = data?.map ? getMapDisplayName(data.map) : '';
  useEffect(() => {
    document.title = pageTitle(
      mapName ? t('analysis.title', { map: mapName }) : t('analysis.titlePlain')
    );
  }, [mapName, t]);

  const players = useMemo(() => new Map((data?.players ?? []).map((p) => [p.id, p])), [data]);
  const nameOf = (id: string | null) =>
    id ? (players.get(id)?.name ?? `…${id.slice(-4)}`) : t('analysis.world');

  // Which side each team played each round: the side its players were on in
  // that round's kills; a round without them keeps the last known, switched
  // at halftime (round 13).
  const team1Side = useMemo(() => {
    const out = new Map<number, Side>();
    let last: Side | null = null;
    for (const round of data?.rounds ?? []) {
      const votes = { CT: 0, T: 0 };
      for (const k of data?.kills ?? []) {
        if (k.round !== round.number) continue;
        for (const [id, side] of [
          [k.attacker, k.attackerSide],
          [k.victim, k.victimSide],
        ] as const) {
          if (id && side && players.get(id)?.team === 'team1') votes[side] += 1;
        }
      }
      let side: Side | null = votes.CT || votes.T ? (votes.CT >= votes.T ? 'CT' : 'T') : last;
      if (!(votes.CT || votes.T) && last && round.number === 13) side = last === 'CT' ? 'T' : 'CT';
      if (side) out.set(round.number, side);
      last = side;
    }
    return out;
  }, [data, players]);

  const winnerTeam = (round: Round): TeamKey | null => {
    const side = team1Side.get(round.number);
    if (!round.winner || !side) return null;
    return round.winner === side ? 'team1' : 'team2';
  };
  const score = (data?.rounds ?? []).reduce(
    (acc, r) => {
      const w = winnerTeam(r);
      if (w) acc[w] += 1;
      return acc;
    },
    { team1: 0, team2: 0 }
  );
  const teamSize = (team: TeamKey) =>
    Math.max(1, (data?.players ?? []).filter((p) => p.team === team).length);

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Typography color="text.secondary" data-testid="demo-analysis-missing">
          {t('analysis.missing')}
        </Typography>
      </Container>
    );
  }
  if (!data) {
    return (
      <Box display="flex" justifyContent="center" py={10}>
        <CircularProgress aria-label={t('analysis.loading')} />
      </Box>
    );
  }

  const round = data.rounds.find((r) => r.number === selected) ?? data.rounds[0] ?? null;
  const roundKills = round ? data.kills.filter((k) => k.round === round.number) : [];
  const teamColor = (team: TeamKey | null) =>
    team === 'team1' ? color.accent : team === 'team2' ? color.sideCt : color.rule;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }} data-testid="demo-analysis-page">
      <ButtonBase
        onClick={() => window.history.back()}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          fontSize: textSize.sm,
          color: color.ink2,
        }}
      >
        <ArrowLeftIcon size={14} aria-hidden /> {t('analysis.back')}
      </ButtonBase>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          mt: 1.5,
          mb: 4,
        }}
      >
        <Box>
          <Typography
            sx={{
              fontFamily: mono.fontFamily,
              fontSize: textSize.xs,
              color: color.muted,
              textTransform: 'uppercase',
            }}
          >
            {t('analysis.eyebrow')}
          </Typography>
          <Typography
            component="h1"
            sx={{
              fontFamily: fontDisplay,
              fontSize: { xs: '2rem', md: '2.75rem' },
              fontWeight: 700,
              lineHeight: 1.1,
            }}
          >
            {mapName || t('analysis.titlePlain')}
          </Typography>
        </Box>
        <Box
          data-testid="demo-analysis-score"
          sx={{
            fontFamily: fontDisplay,
            fontSize: '2.5rem',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Box component="span" sx={{ color: color.accent }}>
            {score.team1}
          </Box>
          <Box component="span" sx={{ color: color.muted, mx: 1 }}>
            –
          </Box>
          <Box component="span" sx={{ color: color.sideCt }}>
            {score.team2}
          </Box>
        </Box>
      </Box>

      {/* The rounds: who won each, and each side's buy. */}
      <Box component="section" aria-labelledby="analysis-rounds">
        <SectionHead id="analysis-rounds" title={t('analysis.rounds')} />
        <Box
          role="tablist"
          aria-label={t('analysis.rounds')}
          sx={{ display: 'flex', gap: 0.75, overflowX: 'auto', pb: 1 }}
          data-testid="demo-analysis-rounds"
        >
          {data.rounds.map((r) => {
            const w = winnerTeam(r);
            const active = round?.number === r.number;
            return (
              <ButtonBase
                key={r.number}
                role="tab"
                aria-selected={active}
                aria-label={t('analysis.roundLabel', { n: r.number })}
                onClick={() => setSelected(r.number)}
                sx={{
                  flex: 'none',
                  width: 40,
                  height: 52,
                  borderRadius: radii.md,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 0.5,
                  bgcolor: active ? withAlpha(teamColor(w), 0.25) : color.paper2,
                  border: `1px solid ${active ? teamColor(w) : color.rule}`,
                  fontFamily: mono.fontFamily,
                  fontSize: textSize.xs,
                  color: color.ink2,
                }}
              >
                {r.number}
                <Box
                  aria-hidden
                  sx={{ width: 16, height: 4, borderRadius: 2, bgcolor: teamColor(w) }}
                />
              </ButtonBase>
            );
          })}
        </Box>
      </Box>

      {round && (
        <Panel sx={{ mt: 2, p: { xs: 2, md: 3 } }} data-testid="demo-analysis-round">
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
              mb: 2,
            }}
          >
            <Typography sx={{ fontWeight: 600, fontSize: textSize.lg }}>
              {t('analysis.roundLabel', { n: round.number })}
              {round.reason && (
                <Box
                  component="span"
                  sx={{ color: color.muted, fontWeight: 400, fontSize: textSize.sm, ml: 1.5 }}
                >
                  {t(`analysis.reason.${round.reason}`, { defaultValue: round.reason })}
                </Box>
              )}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              {(['team1', 'team2'] as const).map((team) => {
                const side =
                  team === 'team1'
                    ? team1Side.get(round.number)
                    : team1Side.get(round.number) === 'CT'
                      ? 'T'
                      : 'CT';
                const equipment =
                  side === 'CT' ? round.ctEquipment : side === 'T' ? round.tEquipment : undefined;
                const buy = buyType(round, equipment, teamSize(team));
                return (
                  <Box
                    key={team}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: textSize.sm }}
                    data-testid={`demo-analysis-buy-${team}`}
                  >
                    <Box
                      aria-hidden
                      sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: teamColor(team) }}
                    />
                    <span>{t(`analysis.${team}`)}</span>
                    {side && (
                      <Box component="span" sx={{ color: color.muted }}>
                        {side}
                      </Box>
                    )}
                    {buy && (
                      <Box
                        component="span"
                        sx={{
                          px: 1,
                          borderRadius: radii.pill,
                          bgcolor: color.paper3,
                          color: color.ink2,
                        }}
                      >
                        {t(`analysis.buy.${buy}`)}
                        {equipment !== undefined && buy !== 'pistol'
                          ? ` · $${equipment.toLocaleString()}`
                          : ''}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>

          {roundKills.length === 0 ? (
            <Typography color="text.secondary">{t('analysis.noKills')}</Typography>
          ) : (
            <Box
              component="ol"
              sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.75 }}
              data-testid="demo-analysis-kills"
            >
              {roundKills.map((k, i) => {
                const killerTeam = k.attacker ? (players.get(k.attacker)?.team ?? null) : null;
                const victimTeam = players.get(k.victim)?.team ?? null;
                return (
                  <Box
                    component="li"
                    key={`${k.tick}-${i}`}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '3.25rem minmax(0, 1fr) auto',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 1.5,
                      py: 1,
                      borderRadius: radii.md,
                      bgcolor: color.paper2,
                      fontSize: textSize.sm,
                    }}
                  >
                    <Box sx={{ fontFamily: mono.fontFamily, color: color.muted }}>
                      {clock(k.tick - round.startTick)}
                    </Box>
                    <Box
                      sx={{
                        minWidth: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Box component="span" sx={{ fontWeight: 600, color: teamColor(killerTeam) }}>
                        {nameOf(k.attacker)}
                      </Box>
                      <Box component="span" sx={{ color: color.muted }}>
                        {k.weapon}
                        {k.headshot ? ` · ${t('analysis.hs')}` : ''}
                        {k.penetrated ? ` · ${t('analysis.wallbang')}` : ''}
                        {k.throughSmoke ? ` · ${t('analysis.smoke')}` : ''}
                      </Box>
                      <Box component="span" sx={{ fontWeight: 600, color: teamColor(victimTeam) }}>
                        {nameOf(k.victim)}
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {k.opening && <Tag>{t('analysis.opening')}</Tag>}
                      {k.trade && <Tag tone={color.pick}>{t('analysis.trade')}</Tag>}
                      {k.traded && <Tag tone={color.muted}>{t('analysis.traded')}</Tag>}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Panel>
      )}

      {(['team1', 'team2'] as const).map((team) => {
        const rows = data.players
          .filter((p) => p.team === team)
          .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        if (rows.length === 0) return null;
        return (
          <Box key={team} component="section" aria-labelledby={`analysis-${team}`} sx={{ mt: 5 }}>
            <SectionHead id={`analysis-${team}`} title={t(`analysis.${team}`)} />
            <Box
              sx={{
                overflowX: 'auto',
                borderRadius: radii.lg,
                border: `1px solid ${color.rule}`,
                bgcolor: color.paper2,
              }}
            >
              <Box
                component="table"
                sx={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  minWidth: 880,
                  fontSize: textSize.sm,
                }}
                data-testid={`demo-analysis-table-${team}`}
              >
                <thead>
                  <tr>
                    {[
                      'player',
                      'rating',
                      'kda',
                      'adr',
                      'kast',
                      'hs',
                      'opening',
                      'trades',
                      'clutches',
                      'multi',
                      'crosshair',
                      'ttd',
                      'money',
                    ].map((key) => (
                      <Box
                        component="th"
                        key={key}
                        sx={{
                          p: '10px 12px',
                          textAlign: key === 'player' ? 'left' : 'right',
                          color: color.muted,
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t(`analysis.col.${key}`)}
                      </Box>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <Box
                      component="tr"
                      key={p.id}
                      sx={{
                        borderTop: `1px solid ${color.rule}`,
                        '& td': {
                          p: '10px 12px',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                        },
                      }}
                    >
                      <Box component="td" sx={{ textAlign: 'left !important', fontWeight: 600 }}>
                        {p.name}
                      </Box>
                      <Box component="td" sx={{ fontWeight: 700 }}>
                        {p.rating?.toFixed(2) ?? '—'}
                      </Box>
                      <td>
                        {p.kills}-{p.deaths}-{p.assists}
                      </td>
                      <td>{p.adr ?? '—'}</td>
                      <td>{p.kast === null ? '—' : `${p.kast}%`}</td>
                      <td>{p.headshotPct === null ? '—' : `${p.headshotPct}%`}</td>
                      <td>
                        {p.openingKills}-{p.openingDeaths}
                      </td>
                      <td>{p.tradeKills}</td>
                      <td>
                        {p.clutchesWon}/{p.clutchesPlayed}
                      </td>
                      <td>{p.multiKills.slice(1).reduce((a, b) => a + b, 0)}</td>
                      <td>
                        {p.crosshairDegrees === null ? '—' : `${p.crosshairDegrees.toFixed(1)}°`}
                      </td>
                      <td>{p.timeToDamageMs === null ? '—' : `${p.timeToDamageMs} ms`}</td>
                      <td>${p.moneySpent.toLocaleString()}</td>
                    </Box>
                  ))}
                </tbody>
              </Box>
            </Box>
          </Box>
        );
      })}
      <Typography sx={{ mt: 2, fontSize: textSize.xs, color: color.muted }}>
        {t('analysis.note')}
      </Typography>
    </Container>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <Box
      component="span"
      sx={{
        px: 0.75,
        borderRadius: radii.pill,
        fontSize: textSize.xs,
        bgcolor: withAlpha(tone ?? color.accent, 0.15),
        color: tone ?? color.accent,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}
