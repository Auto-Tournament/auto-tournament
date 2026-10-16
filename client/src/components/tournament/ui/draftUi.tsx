/**
 * The tournament page redesign's shared pieces (the 2026-10 drafts): team
 * logos, player avatars, the status hero every format opens with, info tiles,
 * state pills and map tiles. Colours come from the theme tokens only.
 */
import { SectionHead, panelPaddedSx } from '../../common/ui';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Dialog, Typography, type BoxProps } from '@mui/material';
import { getMapData, getMapDisplayName } from '../../../constants/maps';
import {
  tokens,
  fontDisplay,
  mono,
  radii,
  teamColors,
  textSize,
  withAlpha,
} from '../../../theme/tokens';
import { PlayerAvatar, playerInitials } from '../../player/PlayerAvatar';
import { teamProfilePath } from '../../../paths';
import { Link as RouterLink } from 'react-router-dom';

/** The one player picture lives in components/player/PlayerAvatar. */
export { PlayerAvatar, playerInitials };

const { color } = tokens;

/**
 * Team colours for teams without a logo: their initials on one of these, picked
 * by hashing the team id, so a team keeps its colour on every page.
 */
export const teamPalette: readonly string[] = teamColors;

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Every team's stored colour (GET /api/team-directory/colors), read once per page load.
let storedColors: Record<string, number> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadTeamColors(force = false): void {
  if (loading && !force) return;
  loading = fetch('/api/team-directory/colors', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { colors?: Record<string, number> } | null) => {
      storedColors = d?.colors ?? {};
      listeners.forEach((l) => l());
    })
    .catch(() => undefined);
}

/** Read the colours again (after a team picked another). */
export function refreshTeamColors(): void {
  loadTeamColors(true);
}

/** Re-renders when the stored colours arrive. */
export function useTeamColors(): void {
  useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      loadTeamColors();
      return () => listeners.delete(onChange);
    },
    () => storedColors,
    () => storedColors
  );
}

/** A team's colour: the one it stored, else one picked from its id (a team made outside the directory). */
export function teamColor(key: string): string {
  const stored = storedColors?.[key];
  if (typeof stored === 'number') return teamColors[((stored % 16) + 16) % 16];
  return teamColors[hash(key) % teamColors.length];
}

/** "KenoKnifers" → "KK", "Team Liquid" → "TL", or the team's own tag. */
export function teamInitials(name: string, tag?: string | null): string {
  if (tag && tag.trim()) return tag.trim().slice(0, 4).toUpperCase();
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const caps = name.match(/[A-ZÆØÅ]/g);
  if (caps && caps.length >= 2) return (caps[0] + caps[1]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const LOGO_SIZE = { sm: 22, md: 32, lg: 56, xl: 96 } as const;

export type TeamLike = {
  id?: string | null;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
};

/**
 * A team's logo, or its initials on its team colour: the one way a team is
 * drawn everywhere (lists, cards, headers, brackets). `size` is a preset or
 * pixels; a logo that fails to load falls back to the initials.
 */
export function TeamLogo({
  team,
  size = 'md',
  dim = false,
  sx,
}: {
  team: TeamLike | null | undefined;
  size?: keyof typeof LOGO_SIZE | number;
  dim?: boolean;
  sx?: BoxProps['sx'];
}) {
  useTeamColors();
  const [broken, setBroken] = useState<string | null>(null);
  const px = typeof size === 'number' ? size : LOGO_SIZE[size];
  // Corners and initials grow with the logo.
  const radius = px >= 90 ? 24 : px >= 50 ? 16 : px >= 30 ? 10 : 7;
  const PRESET_FONT = { sm: '0.5625rem', md: '0.75rem', lg: '1.125rem', xl: '1.875rem' } as const;
  const fontSize =
    typeof size === 'number' ? `${Math.max(0.5625, px / 50).toFixed(3)}rem` : PRESET_FONT[size];
  if (!team) {
    return (
      <Box
        component="span"
        aria-hidden
        sx={{
          width: px,
          height: px,
          borderRadius: `${radius}px`,
          bgcolor: color.rule,
          flex: 'none',
          ...sx,
        }}
      />
    );
  }
  if (team.logoUrl && broken !== team.logoUrl) {
    return (
      <Box
        component="img"
        src={team.logoUrl}
        alt=""
        aria-hidden
        data-testid="team-logo"
        onError={() => setBroken(team.logoUrl ?? null)}
        sx={{
          width: px,
          height: px,
          borderRadius: `${radius}px`,
          objectFit: 'cover',
          flex: 'none',
          opacity: dim ? 0.5 : 1,
          ...sx,
        }}
      />
    );
  }
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: px,
        height: px,
        borderRadius: `${radius}px`,
        flex: 'none',
        display: 'inline-grid',
        placeItems: 'center',
        bgcolor: teamColor(team.id || team.name),
        color: color.accentInk,
        fontFamily: fontDisplay,
        fontWeight: 700,
        fontSize,
        letterSpacing: '0.02em',
        opacity: dim ? 0.5 : 1,
        ...sx,
      }}
    >
      {teamInitials(team.name, team.tag)}
    </Box>
  );
}

/** Tones a marking pill comes in: the accent (yours), gold (champions), live, or neutral. */
export type MarkTone = 'accent' | 'gold' | 'live' | 'neutral';

/**
 * A small filled pill that marks something (your team, your match, the
 * champions): the one marking style, instead of coloured outlines that need
 * a legend.
 */
export function MarkPill({
  tone = 'accent',
  children,
  testId,
  sx,
}: {
  tone?: MarkTone;
  children: ReactNode;
  testId?: string;
  sx?: BoxProps['sx'];
}) {
  const bg =
    tone === 'gold'
      ? color.medalGold
      : tone === 'live'
        ? color.live
        : tone === 'neutral'
          ? color.paper3
          : color.accent;
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.25,
        py: 0.25,
        borderRadius: radii.pill,
        bgcolor: bg,
        color: tone === 'neutral' ? color.ink2 : color.accentInk,
        fontSize: textSize.sm,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        flex: 'none',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

/**
 * A team as its logo and name (the one way a team shows in a match card, a row
 * or the bracket): the name links to the team page when there is one, in the
 * accent when it is the viewer's (`yours`). `column` stacks the name under the
 * logo (match cards); `end` puts the logo after the name (the right-hand team).
 * `nameOnPhone: false` leaves only the logo on a phone.
 */
export function TeamIdentity({
  team,
  size = 'sm',
  layout = 'row',
  align = 'start',
  yours = false,
  link = true,
  nameOnPhone = true,
  nameSx,
  tbd,
  testId,
}: {
  team: TeamLike | null | undefined;
  size?: keyof typeof LOGO_SIZE | number;
  layout?: 'row' | 'column';
  align?: 'start' | 'end';
  yours?: boolean;
  link?: boolean;
  nameOnPhone?: boolean;
  nameSx?: BoxProps['sx'];
  /** Text when there is no team yet ("TBD", "Winner of A1"). */
  tbd?: string;
  testId?: string;
}) {
  const linked = link && !!team?.id;
  const name = team ? (
    <Box
      {...(linked
        ? { component: RouterLink, to: teamProfilePath(team.id as string) }
        : { component: 'span' })}
      sx={{
        minWidth: 0,
        display: nameOnPhone ? 'block' : { xs: 'none', sm: 'block' },
        color: yours ? color.accent : color.ink,
        fontWeight: yours ? 700 : 600,
        textDecoration: 'none',
        overflowWrap: layout === 'column' ? 'break-word' : undefined,
        ...(layout === 'row'
          ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
          : {}),
        ...(linked ? { '&:hover': { textDecoration: 'underline' } } : {}),
        ...nameSx,
      }}
    >
      {team.name}
    </Box>
  ) : (
    <Box component="span" sx={{ color: color.muted, minWidth: 0, ...nameSx }}>
      {tbd ?? '—'}
    </Box>
  );
  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'flex',
        flexDirection: layout === 'column' ? 'column' : align === 'end' ? 'row-reverse' : 'row',
        alignItems: 'center',
        justifyContent: layout === 'row' && align === 'end' ? 'flex-start' : undefined,
        gap: layout === 'column' ? 1 : 1,
        minWidth: 0,
        textAlign: layout === 'column' ? 'center' : align === 'end' ? 'right' : 'left',
      }}
    >
      <TeamLogo team={team} size={size} />
      {name}
    </Box>
  );
}

/**
 * How a team reads in a result, the same everywhere (bracket, match cards, rows):
 * your team's name in the accent so you find yourself, every other name in ink;
 * who won shows in the score only (green won, red lost). Never a greyed or faded
 * loser: that reads as cancelled or kicked.
 */
export function resultInk({
  teamId,
  winnerId,
  done = true,
  yourTeamId,
}: {
  teamId?: string | null;
  winnerId?: string | null;
  done?: boolean;
  yourTeamId?: string | null;
}) {
  const decided = done && !!winnerId;
  const won = decided && !!teamId && teamId === winnerId;
  const lost = decided && !!teamId && teamId !== winnerId;
  const yours = !!teamId && !!yourTeamId && teamId === yourTeamId;
  return {
    won,
    lost,
    yours,
    name: yours ? color.accent : color.ink,
    score: won ? color.live : lost ? color.ban : color.ink,
  };
}

/** "Your team" / "Your match": the viewer's own, marked the same way everywhere. */
export function YoursPill({
  kind = 'team',
  testId,
  sx,
}: {
  kind?: 'team' | 'match';
  testId?: string;
  sx?: BoxProps['sx'];
}) {
  const { t } = useTranslation();
  return (
    <MarkPill testId={testId} sx={sx}>
      {kind === 'match' ? t('matchesCards.yourMatch') : t('overviewPage.teamsTab.yours')}
    </MarkPill>
  );
}

/** Two or more avatars overlapping: a shuffle team on a phone. */
export function AvatarStack({
  players,
  size = 26,
}: {
  players: Array<{ name: string; avatar?: string | null }>;
  size?: number;
}) {
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex' }}
      aria-label={players.map((p) => p.name).join(', ')}
    >
      {players.map((p, i) => (
        <PlayerAvatar
          key={`${p.name}-${i}`}
          name={p.name}
          avatar={p.avatar}
          size={size}
          sx={{ ml: i ? '-6px' : 0, outline: `2px solid ${color.paper2}` }}
        />
      ))}
    </Box>
  );
}

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

export type MatchState = 'live' | 'done' | 'upcoming' | 'now' | 'next' | 'later' | 'veto';

/** "Live", "Done", "Next": the same colour for the same state on every page. */
export function StatePill({ state, label }: { state: MatchState; label: ReactNode }) {
  const bg =
    state === 'live' || state === 'now'
      ? color.live
      : state === 'done'
        ? color.muted
        : state === 'veto'
          ? color.accent
          : state === 'upcoming'
            ? color.ink
            : color.ink2;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1,
        py: 0.5,
        borderRadius: radii.pill,
        bgcolor: bg,
        color: color.accentInk,
        fontSize: textSize.sm,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
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
