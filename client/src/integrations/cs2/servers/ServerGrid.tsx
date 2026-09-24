import React, { useEffect, useState } from 'react';
import { Box, Chip, Skeleton } from '@mui/material';
import type { ManageResourcesProps } from '../../types';
import {
  api,
  getBracketMatchLabel,
  links,
  LiveChip,
  radii,
  SectionHead,
  textSize,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';
import type { ServerAllocationInfo } from '../cs2.types';
import { useServerAvailability } from './useServerAvailability';
import { useUnconfiguredServers } from './useUnconfiguredServers';

/** The two team names of a match, for a server running one with no bracket label. */
type TeamNames = { team1?: string; team2?: string };

/**
 * The team names of the matches the servers are running, asked per match the
 * first time a server shows one. A match keeps its teams while it runs, so an
 * answer is kept for as long as the grid is open.
 */
function useTeamNames(slugs: string[]): Map<string, TeamNames> {
  const [names, setNames] = useState<Map<string, TeamNames>>(() => new Map());
  const missing = slugs.filter((slug) => !names.has(slug));
  const missingKey = missing.join(',');

  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    void Promise.all(
      missingKey.split(',').map(async (slug): Promise<[string, TeamNames]> => {
        try {
          const res = await api.get<{
            match?: { team1?: { name?: string } | null; team2?: { name?: string } | null };
          }>(`/api/matches/${encodeURIComponent(slug)}`);
          return [slug, { team1: res.match?.team1?.name, team2: res.match?.team2?.name }];
        } catch {
          return [slug, {}];
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setNames((prev) => {
        const next = new Map(prev);
        for (const [slug, teams] of entries) next.set(slug, teams);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  return names;
}

/**
 * The Manage console's server grid (`dashboardWidgets.manageResources`). It
 * asks the fleet itself on the console's 5-second cadence, and the team names
 * of what runs on it (client API 0.2.0): the console hands it only the
 * tournament.
 */
export const ServerGrid: React.FC<ManageResourcesProps> = () => {
  const { availability, answers } = useServerAvailability(5000);
  const servers = availability?.servers ?? [];
  const unconfigured = useUnconfiguredServers(30_000);
  const teamNames = useTeamNames(
    servers.filter((s) => !bracketLabel(s)).flatMap((s) => (s.matchSlug ? [s.matchSlug] : []))
  );
  return (
    <ServerGridView
      servers={servers}
      unconfigured={unconfigured}
      teamNames={teamNames}
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

function timeAgo(unixSeconds: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
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
  'data-testid'?: string;
}> = ({ name, chip, line, bad, ...rest }) => (
  <Box
    data-testid={rest['data-testid']}
    sx={{
      p: 2,
      display: 'grid',
      gap: 0.5,
      alignContent: 'start',
      minWidth: 0,
      fontSize: textSize.sm,
      border: `1px solid ${bad ? tokens.color.ban : tokens.color.rule}`,
      borderRadius: radii.md,
    }}
  >
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      <Box component="b" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </Box>
      {chip}
    </Box>
    <Box component="span" sx={{ color: tokens.color.muted, overflowWrap: 'anywhere' }}>
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
  teamNames: Map<string, TeamNames>;
  /** How many availability answers have arrived; 0 while the first is on its way. */
  answers: number;
}> = ({ servers, unconfigured, teamNames, answers }) => {
  const { t } = useModuleTranslation('cs2');

  const body = () => {
    if (answers === 0) {
      return (
        <Box sx={gridSx} aria-busy="true" aria-label={t('managePage.servers.loading')} data-testid="manage-servers-loading">
          {[0, 1, 2].map((key) => (
            <Tile
              key={key}
              name={<Skeleton width={80} />}
              chip={<Skeleton variant="rounded" width={56} height={22} sx={{ borderRadius: radii.pill }} />}
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
        {servers.map((server) => {
          const match = server.matchSlug ? teamNames.get(server.matchSlug) : undefined;
          const matchLabel =
            server.matchSlug &&
            (bracketLabel(server) ||
              (match?.team1 && match?.team2
                ? t('managePage.needsYou.vsLabel', {
                    team1: match.team1,
                    team2: match.team2,
                  })
                : server.matchSlug));

          if (!server.online) {
            const neverHeard = !server.updatedAt;
            if (neverHeard && answers < 2) {
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
                  <Chip size="small" label={t('managePage.servers.offline')} sx={{ color: tokens.color.ban }} />
                }
                line={
                  server.updatedAt
                    ? t('managePage.servers.lastHeartbeat', { time: timeAgo(server.updatedAt, t) })
                    : t('managePage.servers.noHeartbeat')
                }
              />
            );
          }

          if (matchLabel) {
            return (
              <Tile
                key={server.id}
                name={server.name}
                chip={<LiveChip label={t('managePage.servers.inMatch')} />}
                line={matchLabel}
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
            chip={<Chip size="small" variant="outlined" label={t('managePage.servers.notConfigured')} />}
            line={t('managePage.servers.notConfiguredHint')}
          />
        ))}
      </Box>
    );
  };

  return (
    <Box component="section" mt={6} data-testid="manage-servers" aria-labelledby="manage-servers-heading">
      <SectionHead
        id="manage-servers-heading"
        title={t('managePage.servers.heading')}
        link={{ to: links.servers(), label: t('managePage.servers.viewAll') }}
      />
      {body()}
    </Box>
  );
};
