import type { MouseEvent, ReactNode } from 'react';
import { Box, ButtonBase, Tooltip } from '@mui/material';
import { WarningIcon } from '@phosphor-icons/react';
import { openMatchDetails, radii, tokens, useModuleTranslation } from '../../../../module-sdk';
import type { FleetServer } from '../../cs2.types';
import { serverState } from '../machineState';
import { runningOf } from '../fleet/MachineCard';
import {
  MOVING,
  StateChip,
  StateMark,
  stateTone,
  useMatchLine,
  useStateLabel,
} from '../fleet/serverStateMark';
import type { ServerMatch } from '../fleet/useServerMatches';
import { isGuessedAddress, rowMatchKey, type ServerRow } from './serverGroups';
import { CopyConnect } from './CopyConnect';
import { formatWhenShort } from '../time';
import {
  DOT,
  Line,
  RowMenu,
  rowGrid,
  type ServerAction,
  type ServerListProps,
} from './ServerListParts';

const { color } = tokens;

type ReadyUpWord = 'free' | 'busy' | 'offline';

function readyUpWord(f: FleetServer): ReadyUpWord {
  if (!f.online) return 'offline';
  return f.availability === 'available' ? 'free' : 'busy';
}

const readyUpTone: Record<ReadyUpWord, string> = {
  free: stateTone.free,
  busy: color.info,
  offline: stateTone.offline,
};

export function ServerListRow({ row, props }: { row: ServerRow; props: ServerListProps }) {
  const { t, i18n } = useModuleTranslation('cs2');
  const stateLabel = useStateLabel();
  const matchLine = useMatchLine();
  const locale = i18n.language;
  const readyUpLabel = (word: ReadyUpWord) =>
    word === 'busy'
      ? t('managePage.servers.busy')
      : stateLabel(word === 'free' ? 'free' : 'offline');
  const fleetServer: FleetServer | null = row.fleet;

  let name: string;
  let mark: ReactNode;
  let state: ReactNode;
  let reason: ReactNode = null;
  let address: string | null = null;
  let version: string | null = null;
  let match: ServerMatch | null = null;
  let line = '';

  if (row.kind === 'machine') {
    const { host, server } = row;
    const machineState = serverState(host, server, props.fleet.isDeleting(host, server.name));
    const matchKey = rowMatchKey(row);
    match = matchKey ? (props.matches[matchKey] ?? null) : null;
    line = match ? matchLine(match) : '';
    name = row.fleet?.name ?? server.fleetServer?.name ?? server.name;
    // The machine's word while csm moves it, stopped or down; Ready Up's once it runs.
    const readyUpSays =
      row.fleet &&
      !MOVING.includes(machineState) &&
      machineState !== 'stopped' &&
      machineState !== 'offline';
    const inMatch =
      match !== null &&
      !MOVING.includes(machineState) &&
      machineState !== 'stopped' &&
      machineState !== 'offline';
    if (inMatch) {
      mark = <StateMark state="match" />;
      state = <StateChip label={stateLabel('match', match)} tone={stateTone.match} />;
    } else if (readyUpSays && row.fleet) {
      const word = readyUpWord(row.fleet);
      mark = <Box aria-hidden sx={{ ...DOT, bgcolor: readyUpTone[word] }} />;
      state = <StateChip label={readyUpLabel(word)} tone={readyUpTone[word]} />;
    } else {
      mark = <StateMark state={machineState} />;
      state = <StateChip label={stateLabel(machineState, match)} tone={stateTone[machineState]} />;
    }
    if (inMatch && line) {
      reason = <Line area="sub">{line}</Line>;
    } else if (MOVING.includes(machineState)) {
      // Its own command, else the machine update it is part of.
      const own =
        host.commands.find(
          (c) =>
            c.status === 'pending' && (c.server === server.name || c.payload.server === server.name)
        ) ??
        runningOf(host, 'host.update_game') ??
        runningOf(host, 'host.update_plugins');
      reason = (
        <Line area="sub">
          {own?.progress.step ??
            (own?.seq === null
              ? t('serversBoard.waitingForCsm', { defaultValue: 'Waiting for csm' })
              : t('serversBoard.csmOnIt', { defaultValue: 'csm is on it' }))}
        </Line>
      );
    } else if (machineState === 'stopped') {
      reason = (
        <Line area="sub">
          {t('serversBoard.stoppedLine', { defaultValue: 'Starts when a match needs it' })}
        </Line>
      );
    } else if (machineState === 'offline') {
      reason = (
        <Line area="sub">
          {host.online
            ? t('serversBoard.notAnswering', { defaultValue: 'Not answering' })
            : t('serversBoard.machineOffline', { defaultValue: 'Its machine is offline' })}
        </Line>
      );
    } else if (server.process.restarts_24h > 0) {
      reason = (
        <Line area="sub">
          {t('serversBoard.restarts', {
            defaultValue: '{{count}} restarts in 24 h',
            count: server.process.restarts_24h,
          })}
        </Line>
      );
    }
    address =
      row.fleet?.connect?.address ??
      (host.hostname ? `${host.hostname}:${server.game_port}` : null);
    version = row.fleet?.versions?.core ?? server.readyup.installed;
  } else {
    const f = row.fleet;
    match = props.matches[rowMatchKey(row) ?? f.id] ?? null;
    line = match ? matchLine(match) : '';
    const inMatch = match !== null && f.status === 'enrolled' && f.online;
    name = f.name;
    mark = (
      <Box
        aria-hidden
        sx={{ ...DOT, bgcolor: inMatch ? stateTone.match : readyUpTone[readyUpWord(f)] }}
      />
    );
    if (inMatch) {
      state = <StateChip label={stateLabel('match', match)} tone={stateTone.match} />;
    } else if (f.status === 'enrolled') {
      const word = readyUpWord(f);
      state = <StateChip label={readyUpLabel(word)} tone={readyUpTone[word]} />;
    } else {
      state = <StateChip label={t(`fleetPanel.status.${f.status}`)} tone={color.muted} />;
    }
    if (inMatch && line) {
      reason = <Line area="sub">{line}</Line>;
    } else if (f.status === 'enrolled' && !f.online && f.lastSeen) {
      reason = (
        <Line area="sub">
          {t('serversList.seen', {
            defaultValue: 'Seen {{time}}',
            time: formatWhenShort(f.lastSeen, locale),
          })}
        </Line>
      );
    } else if (f.status === 'pending' && f.codeExpiresAt) {
      reason = (
        <Line area="sub">
          {t('fleetPanel.codeExpires', { time: formatWhenShort(f.codeExpiresAt, locale) })}
        </Line>
      );
    }
    address = f.connect?.address ?? (f.host ? `${f.host.hostname}:${f.host.game_port}` : null);
    version = f.versions?.core ?? null;
  }

  const guessed = fleetServer ? isGuessedAddress(fleetServer) : false;
  const items: ServerAction[] = [
    {
      id: 'open',
      label: t('serversList.open', { defaultValue: 'Open' }),
      run: () => props.onOpen(row),
    },
    ...(match
      ? [
          {
            id: 'match' as const,
            label: t('serversBoard.openMatch', { defaultValue: 'Open the match' }),
            testId: `server-row-open-match-${row.key}`,
            run: () => void openMatchDetails(match.slug).catch(() => undefined),
          },
        ]
      : []),
  ];
  const addressLine = address && (
    <>
      <CopyConnect address={address} />
      {guessed && (
        <Tooltip
          title={t('fleetPanel.connectGuessed', {
            defaultValue:
              'Guessed from where the server connects from. Check it, or set the address players use.',
          })}
        >
          <Box
            component="span"
            data-testid={`server-row-guessed-${row.key}`}
            sx={{ display: 'inline-flex', verticalAlign: 'middle', ml: 0.5, color: 'warning.main' }}
          >
            <WarningIcon size={13} aria-hidden />
          </Box>
        </Tooltip>
      )}
    </>
  );

  return (
    <Box
      role="listitem"
      data-testid={`server-row-${row.key}`}
      onClick={() => props.onOpen(row)}
      sx={rowGrid}
    >
      <Box
        data-testid={`server-row-dot-${row.key}`}
        sx={{ gridArea: 'dot', display: 'flex', justifyContent: 'center' }}
      >
        {mark}
      </Box>
      <Box sx={{ gridArea: 'name', minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ButtonBase
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            props.onOpen(row);
          }}
          title={name}
          sx={{
            minWidth: 0,
            justifyContent: 'flex-start',
            borderRadius: radii.sm,
            fontWeight: 600,
            fontSize: '0.875rem',
            '&.Mui-focusVisible': { outline: `2px solid ${color.focus}` },
          }}
        >
          <Box
            component="span"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {name}
          </Box>
        </ButtonBase>
      </Box>
      <Box
        data-testid={`server-row-state-${row.key}`}
        sx={{ gridArea: 'state', display: 'flex', minWidth: 0 }}
      >
        {state}
      </Box>
      {reason ? (
        <Box
          sx={{
            gridArea: 'sub',
            minWidth: 0,
            '& > *': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          }}
        >
          {reason}
        </Box>
      ) : (
        addressLine && (
          <Line area="sub" phoneOnly monoText>
            {addressLine}
          </Line>
        )
      )}
      <Line area="addr" wide monoText testId={`server-row-address-${row.key}`}>
        {addressLine ?? '—'}
      </Line>
      <Line area="ver" wide monoText testId={`server-row-version-${row.key}`}>
        {version ?? '—'}
      </Line>
      <Box
        sx={{
          gridArea: 'actions',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 0.25,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <RowMenu name={name} items={items} testId={`server-row-menu-${row.key}`} />
      </Box>
    </Box>
  );
}
