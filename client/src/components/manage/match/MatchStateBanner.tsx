import { Box, Button, Typography } from '@mui/material';
import { fontDisplay, fontMono, radii, textSize, tokens } from '../../../theme/tokens';

const { color } = tokens;

export interface BannerButton {
  label: string;
  /** primary: the action the state calls for; server: a csm/platform move; plain: the rest. */
  tone?: 'primary' | 'server' | 'plain';
  onClick: () => void;
  testId?: string;
}

export type BannerTone = 'progress' | 'ok' | 'attention' | 'problem' | 'done';

const TAG_COLOR: Record<BannerTone, string> = {
  progress: color.warning,
  ok: color.live,
  attention: color.warning,
  problem: color.ban,
  done: color.muted,
};

const BORDER: Record<BannerTone, string> = {
  progress: color.rule,
  ok: color.rule,
  attention: 'rgba(255, 176, 143, 0.35)',
  problem: 'rgba(248, 113, 113, 0.45)',
  done: color.rule,
};

/**
 * The top of the admin match page in each state (the MatchStates board):
 * what the match is doing in one line, the detail under it, and only the
 * actions that state calls for. Controls that make no sense in a state are
 * left out further down the page, not greyed.
 */
export function MatchStateBanner({
  name,
  tone,
  title,
  body,
  buttons,
}: {
  /** The state's name: "Veto", "Warmup", "Server offline". */
  name: string;
  tone: BannerTone;
  title: string;
  body?: string;
  buttons: BannerButton[];
}) {
  return (
    <Box
      component="section"
      aria-label={name}
      data-testid="manage-state"
      data-state={name}
      sx={{
        bgcolor: color.paper2,
        border: `1px solid ${BORDER[tone]}`,
        borderRadius: radii.lg,
        p: { xs: 2, md: 2.5 },
        display: 'grid',
        gap: 1.25,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography
          component="span"
          sx={{
            fontFamily: fontMono,
            fontSize: textSize.xs,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: TAG_COLOR[tone],
          }}
        >
          {name}
        </Typography>
        <Typography
          component="h2"
          sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.25rem', m: 0 }}
        >
          {title}
        </Typography>
      </Box>
      {body && (
        <Typography sx={{ color: color.ink2, fontSize: textSize.sm, lineHeight: 1.55 }}>
          {body}
        </Typography>
      )}
      {buttons.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
          {buttons.map((b) => {
            const bg =
              b.tone === 'primary' ? color.accent : b.tone === 'server' ? color.info : color.paper3;
            const fg = b.tone === 'primary' || b.tone === 'server' ? color.paper : color.ink;
            return (
              <Button
                key={b.label}
                onClick={b.onClick}
                data-testid={b.testId}
                sx={{
                  height: 42,
                  px: 2,
                  borderRadius: radii.md,
                  bgcolor: bg,
                  color: fg,
                  border: `1px solid ${b.tone === 'plain' || !b.tone ? color.rule : bg}`,
                  fontWeight: 600,
                  '&:hover': { bgcolor: bg, filter: 'brightness(1.1)' },
                }}
              >
                {b.label}
              </Button>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
