/** A Ready Up server that is on no machine, in its panel: its state, where players connect, its version. */
import { Button, Stack } from '@mui/material';
import { openMatchDetails, useModuleTranslation } from '../../../../module-sdk';
import type { FleetServer } from '../../cs2.types';
import { ServerSettings } from '../fleet/ServerSettings';
import { Facts, SideSheet } from '../fleet/SideSheet';
import { StateChip, stateTone, useMatchLine, useStateLabel } from '../fleet/serverStateMark';
import type { ServerMatch } from '../fleet/useServerMatches';
import { formatWhen } from '../time';
import { CopyConnect } from './CopyConnect';

export function ReadyUpSheet({
  server,
  match,
  onClose,
}: {
  server: FleetServer | null;
  match: ServerMatch | null;
  onClose: () => void;
}) {
  const { t, i18n } = useModuleTranslation('cs2');
  const stateLabel = useStateLabel();
  const matchLine = useMatchLine();
  const up = !!server?.online;
  const state = readyUpState();
  function readyUpState(): { label: string; tone: string } | null {
    if (!server) return null;
    if (!up) return { label: stateLabel('offline'), tone: stateTone.offline };
    if (match) return { label: stateLabel('match', match), tone: stateTone.match };
    if (server.availability === 'available')
      return { label: stateLabel('free'), tone: stateTone.free };
    return { label: t('managePage.servers.busy'), tone: stateTone.match };
  }
  const address = server?.connect?.address ?? null;
  return (
    <SideSheet
      open={!!server}
      onClose={onClose}
      testId="server-sheet-readyup"
      title={server?.name ?? ''}
      subtitle={t('serversList.noMachine', { defaultValue: 'No machine' })}
    >
      {server && (
        <>
          <Facts
            items={[
              [
                t('serversBoard.facts.state', { defaultValue: 'State' }),
                state && <StateChip key="state" label={state.label} tone={state.tone} />,
              ],
              match && [t('serversBoard.facts.match', { defaultValue: 'Match' }), matchLine(match)],
              !!address && [
                t('serversList.address', { defaultValue: 'Address' }),
                <CopyConnect key="address" address={address} />,
              ],
              [
                'Ready Up',
                server.versions?.core ??
                  t('machinesPanel.noReadyUp', { defaultValue: 'No Ready Up' }),
              ],
              [
                t('serversList.lastSeen', { defaultValue: 'Last seen' }),
                formatWhen(server.lastSeen, i18n.language),
              ],
            ]}
          />
          <Stack direction="row" gap={1} flexWrap="wrap">
            {match && (
              <Button
                variant="contained"
                size="small"
                onClick={() => void openMatchDetails(match.slug)}
                data-testid="server-sheet-match"
              >
                {t('serversBoard.openMatch', { defaultValue: 'Open the match' })}
              </Button>
            )}
            {server.linkedServerId && <ServerSettings linkedId={server.linkedServerId} />}
          </Stack>
        </>
      )}
    </SideSheet>
  );
}
