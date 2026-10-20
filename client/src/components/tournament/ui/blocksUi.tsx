/**
 * Panels, the status and champion heroes, info and map tiles, section titles and the draft dialog (from draftUi.tsx).
 */
import { SectionHead, panelPaddedSx } from '../../common/ui';
import { type ReactNode } from 'react';
import { Box, Dialog, Typography } from '@mui/material';
import { getMapData, getMapDisplayName } from '../../../constants/maps';
import { tokens, fontDisplay, mono, radii, textSize, withAlpha } from '../../../theme/tokens';
import { type TeamLike, TeamLogo } from './teamUi';

const { color } = tokens;

/** The padded panel: the one in components/common/ui (`Panel padded`), as an sx object. */
export const panel = panelPaddedSx;

export const eyebrowSx = {
  fontSize: textSize.sm,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: color.muted,
} as const;

export const h2Sx = {
  m: 0,
  fontFamily: fontDisplay,
  fontSize: '1.25rem',
  fontWeight: 700,
  lineHeight: 1.25,
} as const;

/**
 * The block every tournament page opens with: where the viewer stands
 * (eyebrow), what that means (title), what happens next (body), and on the
 * right a tile with the next time plus the one action that matters.
 */
export function StatusHero({
  eyebrow,
  eyebrowColor = color.muted,
  title,
  body,
  ring = color.rule,
  side,
  children,
  testId,
}: {
  eyebrow: ReactNode;
  eyebrowColor?: string;
  title: ReactNode;
  body?: ReactNode;
  ring?: string;
  side?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Box
      component="section"
      aria-labelledby="status-hero-title"
      data-testid={testId ?? 'status-hero'}
      sx={{
        ...panel,
        border: `2px solid ${ring}`,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: { xs: 2.5, sm: 3.5 },
        p: { xs: 2.5, sm: 3.5 },
      }}
    >
      <Box
        sx={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}
      >
        <Typography component="div" sx={{ ...eyebrowSx, color: eyebrowColor, fontWeight: 600 }}>
          {eyebrow}
        </Typography>
        <Typography
          id="status-hero-title"
          component="h2"
          sx={{
            m: 0,
            fontFamily: fontDisplay,
            fontSize: { xs: '1.75rem', sm: '2.5rem' },
            lineHeight: 1.1,
            fontWeight: 700,
            overflowWrap: 'anywhere',
          }}
        >
          {title}
        </Typography>
        {body && (
          <Typography
            sx={{
              m: 0,
              fontSize: '1.0625rem',
              lineHeight: 1.5,
              color: color.ink2,
              maxWidth: '56ch',
            }}
          >
            {body}
          </Typography>
        )}
        {children}
      </Box>
      {side && (
        <Box
          sx={{
            flex: '0 1 300px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
            alignItems: 'stretch',
            minWidth: 0,
          }}
        >
          {side}
        </Box>
      )}
    </Box>
  );
}

/** A label, a value and a note, on the inset surface: "Next draw · in ~4 min". */
export function InfoTile({
  label,
  value,
  note,
  mono: isMono = false,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  mono?: boolean;
}) {
  return (
    <Box
      sx={{
        borderRadius: radii.md,
        bgcolor: color.paper3,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minWidth: 0,
      }}
    >
      <Typography component="span" sx={eyebrowSx}>
        {label}
      </Typography>
      <Typography
        component="span"
        sx={{
          fontFamily: isMono ? mono.fontFamily : fontDisplay,
          fontSize: isMono ? { xs: '1.375rem', sm: '1.875rem' } : { xs: '1.25rem', sm: '1.625rem' },
          fontWeight: isMono ? 500 : 700,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
      {note && (
        <Typography component="span" sx={{ fontSize: '0.875rem', color: color.ink2 }}>
          {note}
        </Typography>
      )}
    </Box>
  );
}

/** A map's picture with its name over a dark gradient; greyed once it is played. */
export function MapTile({
  map,
  ring = 'transparent',
  played = false,
  top,
  children,
  aspect = '16 / 10',
}: {
  map: string;
  ring?: string;
  played?: boolean;
  top?: ReactNode;
  children?: ReactNode;
  aspect?: string;
}) {
  const data = getMapData(map);
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: radii.md,
        bgcolor: color.paper3,
        aspectRatio: aspect,
        maxWidth: '100%',
      }}
    >
      {data?.thumbnail && (
        <Box
          component="img"
          src={data.thumbnail}
          alt=""
          loading="lazy"
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: played ? 'grayscale(1) brightness(0.5)' : 'none',
          }}
        />
      )}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: `linear-gradient(to top, ${withAlpha(color.paper, 0.92)}, ${withAlpha(color.paper, 0.35)} 55%, ${withAlpha(color.paper, 0.05)})`,
          // The ring over the picture: a border would leave a frame the picture and the shade don't cover.
          borderRadius: 'inherit',
          boxShadow: ring === 'transparent' ? 'none' : `inset 0 0 0 2px ${ring}`,
        }}
      >
        <Box
          sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}
        >
          {top}
        </Box>
        <Box>
          {children ?? (
            <Typography
              sx={{
                fontFamily: fontDisplay,
                fontSize: '1.25rem',
                fontWeight: 700,
                color: color.ink,
              }}
            >
              {getMapDisplayName(map)}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** A section's title with an optional note on the right, for the page's panels. */
/** A section's title with a muted note on the right: the one `SectionHead`, with no gap under it (a panel's gap spaces it). */
export function SectionTitle({
  id,
  title,
  note,
}: {
  id?: string;
  title: ReactNode;
  note?: ReactNode;
}) {
  return <SectionHead id={id} title={title} note={note} sx={{ mb: 0 }} />;
}

/**
 * The champions, big (Standings and Results once it is over): the final's map
 * behind, the team, its players, and how the final went.
 */
export function ChampionHero({
  team,
  players,
  line,
  map,
  label,
  action,
}: {
  team: TeamLike;
  players?: string[];
  line?: ReactNode;
  map?: string | null;
  label: ReactNode;
  action?: ReactNode;
}) {
  const image = map ? (getMapData(map)?.image ?? getMapData(map)?.thumbnail) : undefined;
  return (
    <Box
      component="section"
      aria-labelledby="champion-name"
      data-testid="tournament-champion"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: radii.lg,
        border: `2px solid ${color.medalGold}`,
        minHeight: 200,
        bgcolor: color.paper2,
      }}
    >
      {image && (
        <Box
          component="img"
          src={image}
          alt=""
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'brightness(0.35)',
          }}
        />
      )}
      <Box
        sx={{
          position: 'relative',
          p: { xs: 2.5, sm: 3.5 },
          display: 'flex',
          flexWrap: 'wrap',
          gap: 3,
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', minWidth: 0 }}>
          <TeamLogo team={team} size="lg" />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
            <Typography
              component="span"
              sx={{ ...eyebrowSx, color: color.medalGold, fontWeight: 700 }}
            >
              {label}
            </Typography>
            <Typography
              id="champion-name"
              component="h2"
              sx={{
                m: 0,
                fontFamily: fontDisplay,
                fontSize: { xs: '2rem', sm: '2.75rem' },
                fontWeight: 700,
                lineHeight: 1.1,
                overflowWrap: 'anywhere',
              }}
            >
              {team.name}
            </Typography>
            {players && players.length > 0 && (
              <Typography sx={{ color: color.ink2 }}>{players.join(' · ')}</Typography>
            )}
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: { xs: 'flex-start', sm: 'flex-end' },
            gap: 1,
          }}
        >
          {line && <Typography sx={{ color: color.ink2 }}>{line}</Typography>}
          {action}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * A pop-up as the drafts draw it: an eyebrow (what happened), a title, the
 * text, then the actions (the main one first, then the quiet one), and an
 * optional small note under them.
 */
export function DraftDialog({
  open = true,
  onClose,
  eyebrow,
  eyebrowColor = color.muted,
  title,
  titleId,
  children,
  actions,
  note,
  testId,
}: {
  open?: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  eyebrowColor?: string;
  title: ReactNode;
  titleId: string;
  children?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  testId?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      aria-labelledby={titleId}
      data-testid={testId}
      PaperProps={{
        sx: {
          width: 'min(520px, calc(100% - 32px))',
          m: 2,
          borderRadius: '24px',
          bgcolor: color.paper,
          border: `1px solid ${color.rule}`,
          backgroundImage: 'none',
          boxShadow: `0 24px 60px ${withAlpha('#000000', 0.5)}`,
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        },
      }}
    >
      {eyebrow && (
        <Typography component="span" sx={{ ...eyebrowSx, color: eyebrowColor, fontWeight: 600 }}>
          {eyebrow}
        </Typography>
      )}
      <Typography id={titleId} component="h2" sx={{ ...h2Sx, fontSize: '1.5rem', lineHeight: 1.2 }}>
        {title}
      </Typography>
      {children}
      {actions && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>{actions}</Box>}
      {note && <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>{note}</Typography>}
    </Dialog>
  );
}
