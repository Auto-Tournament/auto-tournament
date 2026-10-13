import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { CodeIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useIntegrationFor } from '../../integrations/registry';
import { radii } from '../../theme/tokens';
import type { Match } from '../../types';
import ConfirmDialog from '../modals/ConfirmDialog';
import AdminMatchControls from '../admin/AdminMatchControls';
import { MatchHoldPanel } from '../admin/MatchHoldPanel';
import { AddBackupPlayer } from '../admin/AddBackupPlayer';
import { FleetRosterEditor } from '../admin/FleetRosterEditor';

/**
 * An admin's tools in the match room: what the old match dialog had (decide a level series, hold,
 * the server controls, the roster, the config, delete a manual match). Admins open the match
 * room like players do, and run the match from here.
 */
export function MatchAdminPanel({ slug, version }: { slug: string; version: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showError, showSuccess } = useSnackbar();
  const [match, setMatch] = useState<Match | null>(null);
  const [winnerToSet, setWinnerToSet] = useState<'team1' | 'team2' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [config, setConfig] = useState<{ open: boolean; json: string | null; loading: boolean }>({
    open: false,
    json: null,
    loading: false,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ match?: Match }>(`/api/matches/${encodeURIComponent(slug)}`)
      .then((res) => !cancelled && setMatch(res.match ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, version]);

  const integration = useIntegrationFor(match ?? { game: null });
  const ModulePanel = integration.matchPanels.adminMatchView;

  if (!match) return null;

  const team1Name = match.team1?.name || t('matchDetailsModal.team1');
  const team2Name = match.team2?.name || t('matchDetailsModal.team2');
  const isManualMatch = match.round === 0;
  const onServer =
    Boolean(match.serverId) && (match.status === 'live' || match.status === 'loaded');

  const setWinner = async () => {
    const winner = winnerToSet;
    setWinnerToSet(null);
    if (!winner) return;
    try {
      await api.post(`/api/matches/${match.slug}/winner`, { winner });
      showSuccess(t('matchDetailsModal.decision.success'));
    } catch (err) {
      showError((err as Error).message || t('matchDetailsModal.decision.failed'));
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    try {
      await api.delete(`/api/matches/${match.slug}`);
      showSuccess(t('matchDetailsModal.delete.success'));
      navigate('/manage');
    } catch (err) {
      showError((err as Error).message || t('matchDetailsModal.delete.failed'));
    }
  };

  const openConfig = async () => {
    setConfig({ open: true, json: null, loading: true });
    try {
      const response = await api.get<unknown>(`/api/matches/${match.slug}.json`);
      setConfig({ open: true, json: JSON.stringify(response, null, 2), loading: false });
    } catch (err) {
      showError((err as Error).message || t('matchDetailsModal.config.loadFailed'));
      setConfig({ open: true, json: null, loading: false });
    }
  };

  return (
    <Box
      data-testid="match-admin-panel"
      sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: radii.lg }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          {t('matchDetailsModal.adminControls')}
        </Typography>
        <Stack direction="row" gap={1}>
          <Button size="small" variant="outlined" startIcon={<CodeIcon />} onClick={openConfig}>
            {t('matchDetailsModal.config.view')}
          </Button>
          {isManualMatch && (
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={() => setConfirmDelete(true)}
              data-testid="match-admin-delete"
            >
              {t('matchDetailsModal.delete.button')}
            </Button>
          )}
        </Stack>
      </Stack>

      <Stack gap={2}>
        {(match.status as string) === 'needs_decision' && (
          <Alert severity="warning" data-testid="match-admin-decision">
            <Typography variant="body2" gutterBottom>
              {t('matchDetailsModal.decision.body')}
            </Typography>
            <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
              {match.team1 && (
                <Button variant="contained" size="small" onClick={() => setWinnerToSet('team1')}>
                  {t('matchDetailsModal.decision.setWinner', { team: team1Name })}
                </Button>
              )}
              {match.team2 && (
                <Button variant="contained" size="small" onClick={() => setWinnerToSet('team2')}>
                  {t('matchDetailsModal.decision.setWinner', { team: team2Name })}
                </Button>
              )}
            </Box>
          </Alert>
        )}

        {/* Hold it instead of a walkover (the API's services/matchHolds.ts). */}
        {(match.status === 'pending' || match.status === 'ready' || match.status === 'loaded') && (
          <MatchHoldPanel
            matchSlug={match.slug}
            matchStatus={match.status}
            onSuccess={showSuccess}
            onError={showError}
          />
        )}

        {onServer && match.serverId && (
          <>
            <AdminMatchControls
              serverId={match.serverId}
              matchSlug={match.slug}
              matchStatus={match.status}
              hideRestoreBackup={!!ModulePanel}
              onSuccess={showSuccess}
              onError={showError}
            />
            {ModulePanel && (
              <>
                <Divider />
                <ModulePanel
                  matchSlug={match.slug}
                  matchStatus={match.status}
                  onSuccess={showSuccess}
                  onError={showError}
                />
              </>
            )}
            <Divider />
            {/* A Ready Up fleet match edits its roster with match.update; RCON keeps the add-player form. */}
            <FleetRosterEditor
              matchSlug={match.slug}
              onSuccess={showSuccess}
              fallback={
                <AddBackupPlayer
                  matchSlug={match.slug}
                  serverId={match.serverId}
                  team1Name={team1Name}
                  team2Name={team2Name}
                  existingTeam1Players={match.config?.team1?.players || []}
                  existingTeam2Players={match.config?.team2?.players || []}
                  onSuccess={showSuccess}
                  onError={showError}
                />
              }
            />
          </>
        )}
      </Stack>

      <ConfirmDialog
        open={winnerToSet !== null}
        title={t('matchDetailsModal.decision.confirmTitle')}
        message={t('matchDetailsModal.decision.confirmBody', {
          team: winnerToSet === 'team2' ? team2Name : team1Name,
        })}
        confirmLabel={t('matchDetailsModal.decision.confirm')}
        onConfirm={setWinner}
        onCancel={() => setWinnerToSet(null)}
        confirmColor="warning"
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t('matchDetailsModal.delete.dialogTitle')}
        message={t('matchDetailsModal.delete.confirmBody', { slug: match.slug })}
        confirmLabel={t('matchDetailsModal.delete.button')}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
      <Dialog
        open={config.open}
        onClose={() => setConfig((c) => ({ ...c, open: false }))}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h6" fontWeight={600}>
              {t('matchDetailsModal.config.title')}
            </Typography>
            <IconButton onClick={() => setConfig((c) => ({ ...c, open: false }))} edge="end">
              <XIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {config.loading ? (
            <Typography variant="body2" color="text.secondary">
              {t('matchDetailsModal.config.loading')}
            </Typography>
          ) : config.json ? (
            <Box
              component="pre"
              sx={{
                bgcolor: 'background.default',
                borderRadius: radii.sm,
                p: 2,
                fontFamily: 'monospace',
                fontSize: 12,
                maxHeight: 500,
                overflow: 'auto',
                whiteSpace: 'pre',
              }}
            >
              <code>{config.json}</code>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('matchDetailsModal.config.empty')}
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
