/**
 * Team colours, logos and identity for the tournament pages (from draftUi.tsx).
 */
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, type BoxProps } from '@mui/material';
import { tokens, fontDisplay, teamColors } from '../../../theme/tokens';
import { PlayerAvatar } from '../../player/PlayerAvatar';
import { teamProfilePath } from '../../../paths';
import { Link as RouterLink } from 'react-router-dom';
import { MarkPill } from './pillsUi';

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
  players: Array<{ id?: string | null; name: string; avatar?: string | null }>;
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
          id={p.id}
          name={p.name}
          avatar={p.avatar}
          size={size}
          sx={{ ml: i ? '-6px' : 0, outline: `2px solid ${color.paper2}` }}
        />
      ))}
    </Box>
  );
}
