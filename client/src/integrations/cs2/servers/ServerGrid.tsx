import React from 'react';
import { Box, ButtonBase, Chip, Skeleton } from '@mui/material';
import type { ManageResourcesProps } from '../../types';
import {
  getBracketMatchLabel,
  links,
  openMatchDetails,
  radii,
  SectionHead,
  textSize,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';
import type { ServerAllocationInfo } from '../cs2.types';
import { useServerAvailability } from './useServerAvailability';
import { useServerMatches, type ServerMatch } from './fleet/useServerMatches';
import {
  StateChip,
  stateTone,
  useMatchLine,
  useStateLabel,
  useTileMatchLine,
} from './fleet/serverStateMark';
import { useUnconfiguredServers } from './useUnconfiguredServers';
import type { Untrusted } from '../../types';

/**
 * The Manage console's server grid (`dashboardWidgets.manageResources`). It
 * asks the fleet itself on the console's 5-second cadence, and what runs on
 * it (client API 0.2.0): the console hands it only the tournament.
 */
export const ServerGrid: React.FC<ManageResourcesProps> = () => {
  const { availability, answers } = useServerAvailability();
  const servers = availability?.servers ?? [];
  const unconfigured = useUnconfiguredServers(true);
  const matches = useServerMatches(availability?.servers);
  return (
    <ServerGridView
      servers={servers}
      unconfigured={unconfigured}
      matches={matches}
      answers={answers}
    />
  );
};

/** "UB R1 M1" for a double-elimination match; null for one the bracket does not label. */
function bracketLabel(server: ServerAllocationInfo): string | null {
  if (!server.matchSlug || server.matchRound === null) return null;
  return getBracketMatchLabel({
    slug: server.matchSlug,
    bracket: server.matchBracket ?? null,
    round: server.matchRound ?? 0,
    matchNumber: server.matchNumber ?? 0,
  });
}

function timeAgo(
  unixSeconds: number,
  t: (key: string, opts?: Record<string, Untrusted>) => string
): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return t('managePage.needsYou.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('managePage.needsYou.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  return t('managePage.needsYou.hoursAgo', { count: hours });
}

/** Why an online server with no match is not taking one, as one line. */
function heldBackKey(reason: ServerAllocationInfo['notAllocatableReason']): string {
  switch (reason) {
    case 'demo-upload':
      return 'managePage.servers.heldBack.demoUpload';
    case 'cs2-out-of-date':
      return 'managePage.servers.heldBack.outOfDate';
    case 'cs2-unverified':
      return 'managePage.servers.heldBack.unverified';
    default:
      return 'managePage.servers.heldBack.other';
  }
}

/** The tiles' grid (the draft's `.servers`): as many 210px columns as fit. */
const gridSx = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))',
  gap: 1.5,
} as const;

/** One tile (the draft's `.srv`): name and chip on top, one useful line under them. */
const Tile: React.FC<{
  name: React.ReactNode;
  chip: React.ReactNode;
  line: React.ReactNode;
  bad?: boolean;
  lineTitle?: string;
  /** Makes the tile a button that does this. */
  onOpen?: () => void;
  openLabel?: string;
  'data-testid'?: string;
}> = ({ name, chip, line, bad, lineTitle, onOpen, openLabel, ...rest }) => (
  <Box
    component={onOpen ? ButtonBase : 'div'}
    onClick={onOpen}
    aria-label={onOpen ? openLabel : undefined}
    data-testid={rest['data-testid']}
    sx={{
      textAlign: 'left',
      color: 'inherit',
      font: 'inherit',
      fontSize: textSize.sm,
      ...(onOpen && {
        '&:hover': { borderColor: tokens.color.accent },
        '&.Mui-focusVisible': { outline: `2px solid ${tokens.color.focus}` },
      }),
      p: 2,
      display: 'grid',
      gap: 0.5,
      alignContent: 'start',
      minWidth: 0,
      border: `1px solid ${bad ? tokens.color.ban : tokens.color.rule}`,
      borderRadius: radii.md,
    }}
  >
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 1.5,
        rowGap: 0.5,
        minWidth: 0,
      }}
    >
      <Box
        component="b"
        title={typeof name === 'string' ? name : undefined}
        sx={{
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {name}
      </Box>
      {chip}
    </Box>
    <Box
      component="span"
      title={lineTitle}
      sx={{ color: tokens.color.muted, overflowWrap: 'anywhere' }}
    >
      {line}
    </Box>
  </Box>
);

/**
 * Server tiles from the same server-availability data Matches.tsx polls: a
 * chip for the state and one line the chip does not say. Skeletons until the
 * first answer. A server the first answer could not reach and has never
 * heard from reads "Checking" rather than a red "Offline": the status check
 * behind that answer is often still cold, and the next one, five seconds on,
 * says what it really is.
 */
const ServerGridView: React.FC<{
  servers: ServerAllocationInfo[];
  /** Added but never set up: listed so the grid matches the Servers page. */
  unconfigured: { id: string; name: string }[];
  matches: Record<string, ServerMatch>;
  /** How many availability answers have arrived; 0 while the first is on its way. */
  answers: number;
}> = ({ servers, unconfigured, matches, answers }) => {
  const { t } = useModuleTranslation('cs2');
  const stateLabel = useStateLabel();
  const matchLine = useMatchLine();
  const tileMatchLine = useTileMatchLine();
  const checking = answers < 2;
  const ordered = [...servers].sort(
    (a, b) => serverRank(a, matches[a.id], checking) - serverRank(b, matches[b.id], checking)
  );

  const body = () => {
    if (answers === 0) {
      return (
        <Box
          sx={gridSx}
          aria-busy="true"
          aria-label={t('managePage.servers.loading')}
          data-testid="manage-servers-loading"
        >
          {[0, 1, 2].map((key) => (
            <Tile
              key={key}
              name={<Skeleton width={80} />}
              chip={
                <Skeleton
                  variant="rounded"
                  width={56}
                  height={22}
                  sx={{ borderRadius: radii.pill }}
                />
              }
              line={<Skeleton width="70%" />}
            />
          ))}
        </Box>
      );
    }
    if (servers.length === 0 && unconfigured.length === 0) {
      return (
        <Box component="p" sx={{ m: 0, fontSize: textSize.sm, color: tokens.color.muted }}>
          {t('managePage.servers.none')}
        </Box>
      );
    }
    return (
      <Box sx={gridSx}>
        {ordered.map((server) => {
          const match = matches[server.id];

          if (!server.online) {
            const neverHeard = !server.updatedAt;
            if (neverHeard && checking) {
              return (
                <Tile
                  key={server.id}
                  name={server.name}
                  chip={<Chip size="small" label={t('managePage.servers.checking')} />}
                  line={<Skeleton width="70%" />}
                />
              );
            }
            return (
              <Tile
                key={server.id}
                bad
                name={server.name}
                chip={
                  <Chip
                    size="small"
                    label={t('managePage.servers.offline')}
                    sx={{ color: tokens.color.ban }}
                  />
                }
                line={
                  server.updatedAt
                    ? t('managePage.servers.lastHeartbeat', { time: timeAgo(server.updatedAt, t) })
                    : t('managePage.servers.noHeartbeat')
                }
              />
            );
          }

          if (match && server.matchSlug) {
            const slug = server.matchSlug;
            const chipLabel = stateLabel('match', match);
            const line = tileMatchLine(match, bracketLabel(server));
            return (
              <Tile
                key={server.id}
                name={server.name}
                chip={<StateChip label={chipLabel} tone={stateTone.match} />}
                line={line}
                lineTitle={matchLine(match)}
                onOpen={() => void openMatchDetails(slug).catch(() => undefined)}
                openLabel={`${t('serversBoard.openMatch', { defaultValue: 'Open the match' })} ${server.name}: ${chipLabel}, ${line}`}
              />
            );
          }
          // Online and running nothing: free, resting after a match, or
          // held back for a reason of its own.
          if (server.allocatable) {
            return (
              <Tile
                key={server.id}
                name={server.name}
                chip={<Chip size="small" label={t('managePage.servers.free')} />}
                line={t('managePage.servers.ready')}
              />
            );
          }
          if (server.notAllocatableReason === 'grace-window') {
            return (
              <Tile
                key={server.id}
                name={server.name}
                chip={<Chip size="small" label={t('managePage.servers.resting')} />}
                line={t('managePage.servers.readyIn', { count: server.secondsUntilReady ?? 0 })}
              />
            );
          }
          return (
            <Tile
              key={server.id}
              name={server.name}
              chip={<Chip size="small" label={t('managePage.servers.busy')} />}
              line={t(heldBackKey(server.notAllocatableReason))}
            />
          );
        })}
        {unconfigured.map((server) => (
          <Tile
            key={server.id}
            data-testid="manage-server-not-configured"
            name={server.name}
            chip={
              <Chip size="small" variant="outlined" label={t('managePage.servers.notConfigured')} />
            }
            line={t('managePage.servers.notConfiguredHint')}
          />
        ))}
      </Box>
    );
  };

  return (
    <Box
      component="section"
      mt={6}
      data-testid="manage-servers"
      aria-labelledby="manage-servers-heading"
    >
      <SectionHead
        id="manage-servers-heading"
        title={t('managePage.servers.heading')}
        link={{ to: links.servers(), label: t('managePage.servers.viewAll') }}
      />
      {body()}
    </Box>
  );
};

const PHASE_RANK: Record<string, number> = { live: 0, knife: 1, warmup: 2, veto: 3 };

/** Where a tile goes, lowest first: matches by phase, free, resting, busy, still checked, offline. */
function serverRank(
  server: ServerAllocationInfo,
  match: ServerMatch | undefined,
  checking: boolean
): number {
  if (!server.online) return checking && !server.updatedAt ? 13 : 14;
  if (match) return PHASE_RANK[match.phase ?? ''] ?? 4;
  if (server.allocatable) return 10;
  return server.notAllocatableReason === 'grace-window' ? 11 : 12;
}
