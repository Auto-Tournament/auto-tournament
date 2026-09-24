import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useManageData } from '../hooks/useManageData';
import { api } from '../utils/api';
import {
  computeStatusCounts,
  computeNeedsYouItems,
  computeRecentEvents,
  manageMatchRefs,
} from '../utils/manageSelectors';
import { getGlobalMatchNumber, getRoundLabel } from '../utils/matchUtils';
import { usePublishNeedsYouCount } from '../contexts/ManageRailContext';
import { StatusStrip } from '../components/manage/StatusStrip';
import { NeedsYouQueue } from '../components/manage/NeedsYouQueue';
import { useIntegrationFor } from '../integrations/registry';
import { useShellIntegrations, shellModule } from '../hooks/useShellIntegrations';
import { RecentLog } from '../components/manage/RecentLog';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { useModuleTranslation } from '../module-sdk';
import type { Match } from '../types/match.types';

export default function Manage() {
  // The game's resource grid (CS2: servers and what runs on them), from the
  // module the tournament runs (3.0 phase E). A game with no resources has no
  // grid, and the console shows only the work.
  const { shell } = useShellIntegrations();
  const ServerGrid = shellModule(shell, (i) => i.dashboardWidgets.manageResources)
    ?.dashboardWidgets.manageResources;
  const { t } = useTranslation();
  const { setHeaderActions } = usePageHeader();
  const { showSuccess, showError } = useSnackbar();
  const { loading, tournament, matches, availability, refresh } = useManageData();
  // The status strip's own tile, from the module the availability above came
  // from (CS2: servers free). A module with no resources has no tile, and the
  // strip is one tile shorter rather than showing a zero.
  const tournamentIntegration = useIntegrationFor(tournament);
  const ResourceStatusTile = tournament ? tournamentIntegration.manageStatusTile : undefined;
  // The module reads its own answer for the counts and rows the console shows
  // itself (CS2: matches waiting for a server, servers down while holding one).
  const { t: moduleT } = useModuleTranslation(tournamentIntegration.id);
  const { summarizeAvailability, manageNeedsYou } = tournamentIntegration;
  const summary = useMemo(
    () => (availability && summarizeAvailability ? summarizeAvailability(availability) : null),
    [availability, summarizeAvailability]
  );
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceText, setAnnounceText] = useState('');
  const [announcing, setAnnouncing] = useState(false);

  useEffect(() => {
    document.title = t('managePage.title');
  }, [t]);

  const statusCounts = useMemo(
    () => computeStatusCounts(matches, summary?.waitingMatches ?? 0),
    [matches, summary]
  );
  const needsYouItems = useMemo(
    () =>
      computeNeedsYouItems(
        matches,
        availability && manageNeedsYou
          ? manageNeedsYou({ availability, matches: manageMatchRefs(matches), t: moduleT })
          : []
      ),
    [matches, availability, manageNeedsYou, moduleT]
  );
  const recentEvents = useMemo(() => computeRecentEvents(matches), [matches]);
  // The shell's rail shows it next to "Needs you" while this page is open.
  usePublishNeedsYouCount(loading ? null : needsYouItems.length);

  const handleAnnounce = async () => {
    if (!announceText.trim()) return;
    setAnnouncing(true);
    try {
      // Same endpoint AdminTools' "Broadcast" quick action uses (css_asay to
      // every enabled server when no serverIds are given).
      await api.post('/api/rcon/broadcast', { message: announceText });
      showSuccess(t('managePage.announce.success'));
      setAnnounceOpen(false);
      setAnnounceText('');
    } catch (err) {
      showError(err instanceof Error ? err.message : t('managePage.announce.failed'));
    } finally {
      setAnnouncing(false);
    }
  };

  useEffect(() => {
    setHeaderActions(
      <Button
        variant="outlined"
        onClick={() => setAnnounceOpen(true)}
        disabled={!summary || summary.resourceCount === 0}
      >
        {t('managePage.announce.button')}
      </Button>
    );
    return () => setHeaderActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setHeaderActions, t, summary?.resourceCount]);

  if (loading) {
    return (
      <Box>
        <LinearProgress />
      </Box>
    );
  }

  return (
    <Box data-testid="manage-page" sx={{ width: '100%' }}>
      <Box mb={2}>
        <Typography variant="body2" color="text.secondary">
          {tournament?.name ?? t('managePage.noTournament')}
        </Typography>
        <Typography variant="h4" fontWeight={700}>
          {t('managePage.needsYouHeading')}
        </Typography>
      </Box>

      {/* The rail beside this is the admin shell's (`Layout`), on every
          admin page; this page hands it the "Needs you" count. */}
      <StatusStrip
        counts={statusCounts}
        resourceTile={
          ResourceStatusTile ? (
            <ResourceStatusTile availability={availability} />
          ) : null
        }
      />

      <NeedsYouQueue
        items={needsYouItems}
        onDecide={(slug) => {
          const match = matches.find((m) => m.slug === slug);
          if (match) setSelectedMatch(match);
        }}
        onActionDone={refresh}
      />

      {/* The module asks for its own resources and what runs on them. */}
      {ServerGrid && <ServerGrid tournamentId={tournament?.id ?? null} />}

      <RecentLog events={recentEvents} />

      {selectedMatch && (
        <MatchDetailsModal
          match={selectedMatch}
          matchNumber={getGlobalMatchNumber(selectedMatch, matches)}
          roundLabel={getRoundLabel(selectedMatch.round)}
          onClose={() => {
            setSelectedMatch(null);
            refresh();
          }}
          onDeleted={() => {
            setSelectedMatch(null);
            refresh();
          }}
        />
      )}

      <Dialog open={announceOpen} onClose={() => setAnnounceOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('managePage.announce.title')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            sx={{ mt: 1 }}
            label={t('managePage.announce.label')}
            value={announceText}
            onChange={(e) => setAnnounceText(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnounceOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!announceText.trim() || announcing}
            onClick={handleAnnounce}
          >
            {t('managePage.announce.send')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
