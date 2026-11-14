/** Under a wide stage, as the match page drafts draw it: teams, series score and title, then a card per map. */
import { Box, Typography } from '@mui/material';
import { tokens, fontDisplay } from '../../theme/tokens';
import { TeamLogo, type TeamLike } from '../tournament/ui/teamUi';

const { color } = tokens;
const mono = { fontFamily: '"Geist Mono", ui-monospace, monospace' };

type Team = TeamLike | null;

export interface StageMapCard {
  key: string;
  name: string;
  score: string;
  note: string;
  now: boolean;
}

export function StageTitle({
  team1,
  team2,
  score1,
  score2,
  title,
  line,
  maps,
}: {
  team1: Team;
  team2: Team;
  score1: number;
  score2: number;
  title: string;
  line: string;
  maps: StageMapCard[];
}) {
  return (
    <Box data-testid="match-stage-title" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, minWidth: 0 }}>
        <TeamLogo team={team1} size={52} />
        <Typography
          component="div"
          sx={{
            fontFamily: fontDisplay,
            fontWeight: 800,
            fontSize: 40,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          <Box component="span" sx={{ color: color.ink }}>
            {score1}
          </Box>
          <Box component="span" sx={{ color: color.muted, mx: 1.25 }}>
            :
          </Box>
          <Box component="span" sx={{ color: color.ink2 }}>
            {score2}
          </Box>
        </Typography>
        <TeamLogo team={team2} size={52} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
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
      </Box>
      {maps.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 1.25,
          }}
        >
          {maps.map((m) => (
            <Box
              key={m.key}
              data-testid="match-stage-map"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
                px: 1.75,
                py: 1.5,
                borderRadius: `${tokens.radius.md}px`,
                bgcolor: color.paper2,
                border: `1px solid ${m.now ? color.accent : color.rule}`,
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
                <Typography component="span" sx={{ ...mono, color: color.ink }}>
                  {m.score}
                </Typography>
              </Box>
              <Typography component="span" sx={{ color: color.muted, fontSize: 13 }}>
                {m.note}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
