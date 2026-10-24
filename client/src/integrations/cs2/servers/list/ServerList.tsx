/**
 * Every server on one list, grouped by the machine that runs it: one line
 * per server (two on a phone) with its state, why it takes no match, where
 * players connect and its version. A row opens the server's panel; its menu
 * holds the rest.
 */
import { Box, Typography } from '@mui/material';
import { WarningIcon } from '@phosphor-icons/react';
import { radii, tokens, useModuleTranslation } from '../../../../module-sdk';
import { MachineCard } from '../fleet/MachineCard';
import { isGuessedAddress, type ServerGroup } from './serverGroups';
import { ServerListRow } from './ServerListRow';
import type { ServerListProps } from './ServerListParts';

const { color } = tokens;

export type { MachineHandlers, ServerListProps } from './ServerListParts';

/** The list is the grid, so the state column fits the widest chip. Rows are subgrids: one line from `md`, two below (name and state, then the reason or the address). */
const listGrid = {
  display: 'grid',
  columnGap: 1.5,
  gridTemplateColumns: {
    xs: '12px minmax(0, 1fr) auto auto',
    md: '12px minmax(0, 1.3fr) fit-content(168px) minmax(0, 1.6fr) minmax(0, 1fr) 64px 96px',
  },
} as const;

export function ServerList(props: ServerListProps) {
  const { t } = useModuleTranslation('cs2');
  const guessedAny = props.groups.some((g) =>
    g.rows.some((r) => r.fleet && isGuessedAddress(r.fleet))
  );
  const rows = (group: ServerGroup) => (
    <Box role="list" sx={listGrid}>
      {group.rows.map((row) => (
        <ServerListRow key={row.key} row={row} props={props} />
      ))}
    </Box>
  );

  return (
    <Box data-testid="servers-list" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {guessedAny && (
        <Box
          role="status"
          data-testid="servers-guessed-banner"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: 'warning.main',
            fontSize: '0.8125rem',
          }}
        >
          <WarningIcon size={16} style={{ flex: 'none' }} />
          {t('serversList.guessedBanner', {
            defaultValue:
              'Some addresses were guessed from where the server connects. Check them, or set the address players use.',
          })}
        </Box>
      )}
      {props.groups.map((group) => {
        const host = group.host;
        return host ? (
          <Box key={group.key} data-testid={`server-group-${group.key}`}>
            <MachineCard
              host={host}
              onOpenMachine={() => props.machine.onOpen(host)}
              onMenu={(anchor) => props.machine.onMenu(host, anchor)}
              onAddServers={() => props.machine.onAddServers(host)}
              onUpdateGame={() => props.machine.onUpdateGame(host)}
              onUpdateReadyUp={() => props.machine.onUpdateReadyUp(host)}
              onNewCode={() => props.machine.onNewCode(host)}
              onRetry={(c) => props.machine.onRetry(host, c)}
            >
              {group.rows.length > 0 && rows(group)}
            </MachineCard>
          </Box>
        ) : (
          <Box
            key={group.key}
            component="section"
            data-testid={`server-group-${group.key}`}
            aria-labelledby="server-group-none-title"
            sx={{
              borderRadius: radii.lg,
              bgcolor: color.paper2,
              border: `1px solid ${color.rule}`,
              p: { xs: 1.5, md: 2 },
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <Box>
              <Typography
                id="server-group-none-title"
                component="h2"
                sx={{ fontWeight: 600, fontSize: '1rem' }}
              >
                {t('serversList.noMachine', { defaultValue: 'No machine' })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('serversList.noMachineAbout', {
                  defaultValue: 'Ready Up servers that enrolled on their own.',
                })}
              </Typography>
            </Box>
            {rows(group)}
          </Box>
        );
      })}
    </Box>
  );
}
