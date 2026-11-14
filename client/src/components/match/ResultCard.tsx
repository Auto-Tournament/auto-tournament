/** A finished match's result as the match page draft draws it: both teams, the winner, the score and a row per map. */
import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { tokens, fontDisplay } from '../../theme/tokens';
import { TeamLogo, type TeamLike } from '../tournament/ui/teamUi';

const { color } = tokens;
const mono = { fontFamily: '"Geist Mono", ui-monospace, monospace' };

export interface ResultMap {
  mapNumber: number;
  name: string;
  score: string;
  note: string;
}

function Side({ team, label, win }: { team: TeamLike | null; label: string; win: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        textAlign: 'center',
      }}
    >
      <TeamLogo team={team} size={56} />
      <Typography sx={{ fontWeight: 600 }}>{team?.name}</Typography>
      {win ? (
        <Typography
          component="span"
          sx={{
            fontSize: 12,
            fontWeight: 700,
            color: color.accentInk,
            bgcolor: color.live,
            px: 1.25,
            py: 0.375,
            borderRadius: `${tokens.radius.pill}px`,
          }}
        >
          {label}
        </Typography>
      ) : (
        <Box sx={{ height: 24 }} />
      )}
    </Box>
  );
}

export function ResultCard({
  team1,
  team2,
  score1,
  score2,
  winnerSide,
  winnerLabel,
  title,
  line,
  maps,
  action,
}: {
  team1: TeamLike | null;
  team2: TeamLike | null;
  score1: number;
  score2: number;
  winnerSide: 'team1' | 'team2' | null;
  winnerLabel: string;
  title: string;
  line: string;
  maps: ResultMap[];
  /** The game's buttons for a map (CS2: Demo, Analysis). */
  action?: (mapNumber: number) => ReactNode;
}) {
  return (
    <Box data-testid="match-result" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography
          component="h1"
          sx={{ m: 0, fontFamily: fontDisplay, fontWeight: 700, fontSize: 22, lineHeight: 1.2 }}
        >
          {title}
        </Typography>
        {line && (
          <Typography component="span" sx={{ color: color.ink2, fontSize: 14 }}>
            {line}
          </Typography>
        )}
      </Box>
      <Box
        component="section"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          p: 2.5,
          borderRadius: `${tokens.radius.md}px`,
          bgcolor: color.paper2,
          border: `1px solid ${color.rule}`,
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Side team={team1} label={winnerLabel} win={winnerSide === 'team1'} />
          <Typography
            component="div"
            sx={{
              fontFamily: fontDisplay,
              fontWeight: 800,
              fontSize: 44,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            <Box component="span" sx={{ color: winnerSide === 'team2' ? color.ink2 : color.ink }}>
              {score1}
            </Box>
            <Box component="span" sx={{ color: color.muted, mx: 1 }}>
              :
            </Box>
            <Box component="span" sx={{ color: winnerSide === 'team1' ? color.ink2 : color.ink }}>
              {score2}
            </Box>
          </Typography>
          <Side team={team2} label={winnerLabel} win={winnerSide === 'team2'} />
        </Box>
        {maps.map((m) => {
          const buttons = action?.(m.mapNumber);
          return (
            <Box
              key={m.mapNumber}
              data-testid="match-result-map"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
                p: 1.75,
                borderRadius: `${tokens.radius.md}px`,
                bgcolor: color.paper,
                border: `1px solid ${color.rule}`,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 1,
                }}
              >
                <Typography component="span" sx={{ fontWeight: 600 }}>
                  {m.name}
                </Typography>
                <Typography component="span" sx={{ ...mono, fontSize: 16 }}>
                  {m.score}
                </Typography>
              </Box>
              <Typography component="span" sx={{ color: color.muted, fontSize: 13 }}>
                {m.note}
              </Typography>
              {buttons && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{buttons}</Box>}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
