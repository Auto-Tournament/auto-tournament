import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { CaretDownIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { api, useModuleTranslation } from '../../../module-sdk';
import { getMapDisplayName } from '../maps/mapData';
import { vetoHistoryRowSx, vetoMapNameSx } from './vetoStyles';
import type { PreMatchHistoryProps as MatchVetoHistoryProps } from '../../types';
import type { VetoAction, VetoMapResult, VetoStateResponse } from '../cs2.types';

interface VetoHistory {
  actions: VetoAction[];
  /** The maps played, in order, with who picked each (or the decider). */
  pickedMaps: VetoMapResult[];
  team1Name?: string;
  team2Name?: string;
  /** Map id -> the admin's display name, sent with the veto. */
  mapNames: Map<string, string>;
}

/**
 * The veto's record, read once per match. It is only shown once the match is
 * on, when the veto is over and nothing in it moves any more.
 */
function useVetoHistory(matchSlug: string): VetoHistory | null {
  const [history, setHistory] = useState<VetoHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<VetoStateResponse>(`/api/veto/${encodeURIComponent(matchSlug)}`)
      .then((res) => {
        if (cancelled || !res.success || !res.veto) return;
        const actions = Array.isArray(res.veto.actions) ? [...res.veto.actions] : [];
        actions.sort((a, b) => (a.step || 0) - (b.step || 0));
        setHistory({
          actions,
          pickedMaps: Array.isArray(res.veto.pickedMaps)
            ? [...res.veto.pickedMaps].sort((a, b) => (a.mapNumber || 0) - (b.mapNumber || 0))
            : [],
          team1Name: res.veto.team1Name,
          team2Name: res.veto.team2Name,
          mapNames: new Map((res.maps ?? []).map((m) => [m.id, m.displayName])),
        });
      })
      // A match with no veto (no map pool, veto off) answers 404: no history.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [matchSlug]);

  return history;
}

/**
 * The veto's picks and bans, under the match on the team page
 * (`preMatchHistory`). It reads them itself (client API 0.2.0) and renders
 * nothing for a match whose veto recorded none.
 */
export function MatchVetoHistory({ matchSlug }: MatchVetoHistoryProps) {
  const { t } = useModuleTranslation('cs2');
  const history = useVetoHistory(matchSlug);

  if (!history || history.actions.length === 0) {
    return null;
  }
  const { actions } = history;
  const team1Name = history.team1Name || t('matchInfo.team1');
  const team2Name = history.team2Name || t('matchInfo.team2');

  const mapName = (id: string) => history.mapNames.get(id) || getMapDisplayName(id) || id;
  const teamName = (team: string | undefined) =>
    team === 'team1' ? team1Name : team === 'team2' ? team2Name : '';

  return (
    <Stack spacing={1.5}>
      {/* Who picked each map, always in view: the full record stays in the history below. */}
      {history.pickedMaps.length > 0 && (
        <Stack spacing={0.5} data-testid="veto-pick-summary">
          {history.pickedMaps.map((pick) => {
            const decider = pick.pickedBy === 'decider';
            // The side the other team chose for this map: "Team X starts CT".
            const sideTeam = pick.sideTeam1 ? 'team1' : pick.sideTeam2 ? 'team2' : null;
            const side = pick.sideTeam1 || pick.sideTeam2;
            return (
              <Box key={`${pick.mapNumber}-${pick.mapName}`} sx={vetoHistoryRowSx('pick')}>
                <Typography variant="body2">
                  <strong>{t('vetoInterface.pickSummary.map', { number: pick.mapNumber })}</strong>{' '}
                  <Box component="span" sx={vetoMapNameSx('pick')}>
                    {mapName(pick.mapName)}
                  </Box>
                  {' · '}
                  {decider
                    ? t('vetoInterface.pickSummary.decider')
                    : t('vetoInterface.pickSummary.pickedBy', { team: teamName(pick.pickedBy) })}
                  {sideTeam && side
                    ? ` · ${t('vetoInterface.pickSummary.starts', { team: teamName(sideTeam), side: String(side).toUpperCase() })}`
                    : ''}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      )}
      <Accordion>
        <AccordionSummary expandIcon={<CaretDownIcon size={24} />}>
          <Typography variant="subtitle1" fontWeight={600}>
            {t('vetoInterface.vetoHistory')}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1}>
            {actions.map((action, idx) => (
              <Box
                key={`${action.step}-${action.action}-${idx}`}
                sx={vetoHistoryRowSx(action.action)}
              >
                <Typography variant="body2">
                  <strong>{t('vetoInterface.historyStep', { step: action.step })}</strong>{' '}
                  {action.team === 'team1' ? team1Name : team2Name}{' '}
                  <Chip
                    data-testid="veto-history-action"
                    label={t(`vetoInterface.actionLabels.${action.action}`, {
                      defaultValue: action.action.toUpperCase(),
                    })}
                    size="small"
                    color={
                      action.action === 'ban'
                        ? 'error'
                        : action.action === 'pick'
                          ? 'success'
                          : 'info'
                    }
                    sx={{ mx: 1 }}
                  />
                  <Box component="span" sx={vetoMapNameSx(action.action)}>
                    {action.mapName
                      ? history.mapNames.get(action.mapName) ||
                        getMapDisplayName(action.mapName) ||
                        action.mapName
                      : '—'}
                  </Box>
                  {action.side
                    ? ` (${t('vetoInterface.startingSide', { side: action.side })})`
                    : ''}
                </Typography>
              </Box>
            ))}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}
