import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FlagIcon } from '@phosphor-icons/react';
import { PageHead, Row, RowList } from '../components/common/ui';
import { EmptyState } from '../components/shared/EmptyState';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { useSnackbar } from '../contexts/SnackbarContext';
import { api, apiErrorMessage } from '../utils/api';
import { getPlayerPageUrl } from '../utils/playerLinks';
import { pageTitle } from '../utils/pageTitle';

interface Report {
  id: number;
  reported: { id: string; name: string; avatar: string | null; banned: boolean; deleted: boolean };
  reporter: { id: string; name: string } | null;
  reason: 'cheating' | 'toxic' | 'griefing' | 'name' | 'other';
  details: string | null;
  status: 'open' | 'dismissed' | 'actioned';
  createdAt: number;
  handledAt: number | null;
  handledBy: string | null;
  openAboutPlayer: number;
}

/**
 * Admin: player reports. Open ones first; each can be dismissed, or the player
 * banned from it (which closes every open report about them). The reporter
 * is told their report was reviewed, never the outcome.
 */
export default function Reports() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [banFor, setBanFor] = useState<Report | null>(null);
  const [banReason, setBanReason] = useState('');

  useEffect(() => {
    document.title = pageTitle(t('reportsPage.title'));
  }, [t]);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ reports: Report[] }>(`/api/player-reports?status=${filter}`);
      setReports(res.reports);
    } catch (err) {
      showError(apiErrorMessage(err, t('reportsPage.loadError')));
      setReports([]);
    }
  }, [filter, showError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      showSuccess(done);
      await load();
      return true;
    } catch (err) {
      showError(apiErrorMessage(err, t('reportsPage.actionError')));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const when = (s: number) =>
    new Date(s * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Box data-testid="reports-page">
      <PageHead
        title={t('reportsPage.title')}
        subtitle={t('reportsPage.subtitle')}
        actions={
          <ToggleButtonGroup
            size="small"
            exclusive
            value={filter}
            onChange={(_e, v: 'open' | 'all' | null) => v && setFilter(v)}
            aria-label={t('reportsPage.title')}
          >
            <ToggleButton value="open">{t('reportsPage.open')}</ToggleButton>
            <ToggleButton value="all">{t('reportsPage.all')}</ToggleButton>
          </ToggleButtonGroup>
        }
      />

      {reports === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={FlagIcon}
          title={filter === 'open' ? t('reportsPage.emptyOpen') : t('reportsPage.empty')}
          description={t('reportsPage.emptyHelp')}
        />
      ) : (
        <RowList>
          {reports.map((r) => (
            <Row
              key={r.id}
              data-testid={`report-${r.id}`}
              sx={{ alignItems: 'flex-start', flexWrap: 'wrap', columnGap: 2, rowGap: 1, py: 1.5 }}
            >
              <PlayerAvatar
                id={r.reported.id}
                name={r.reported.name}
                avatarUrl={r.reported.avatar ?? undefined}
                size={36}
              />
              <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Link
                    component={RouterLink}
                    to={getPlayerPageUrl(r.reported.id)}
                    fontWeight={600}
                    underline="hover"
                    color="inherit"
                  >
                    {r.reported.name}
                  </Link>
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label={t(`report.reasons.${r.reason}`)}
                  />
                  {r.openAboutPlayer > 1 && r.status === 'open' && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t('reportsPage.openAbout', { count: r.openAboutPlayer })}
                    />
                  )}
                  {r.reported.banned && r.status === 'open' && (
                    <Chip
                      size="small"
                      color="error"
                      variant="outlined"
                      label={t('playersPage.banned')}
                    />
                  )}
                  {r.status !== 'open' && (
                    <Chip
                      size="small"
                      label={
                        r.status === 'actioned'
                          ? t('reportsPage.actioned')
                          : t('reportsPage.dismissed')
                      }
                    />
                  )}
                </Stack>
                {r.details && (
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {r.details}
                  </Typography>
                )}
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ mt: 0.5 }}
                >
                  {t('reportsPage.by', {
                    name: r.reporter?.name ?? t('reportsPage.removedReporter'),
                    time: when(r.createdAt),
                  })}
                </Typography>
              </Box>
              {r.status === 'open' && (
                <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.post(`/api/player-reports/${r.id}/dismiss`, {}),
                        t('reportsPage.dismissedDone')
                      )
                    }
                    data-testid={`report-dismiss-${r.id}`}
                  >
                    {t('reportsPage.dismiss')}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    disabled={busy || r.reported.banned || r.reported.deleted}
                    onClick={() => {
                      setBanReason(
                        `${t(`report.reasons.${r.reason}`)}${r.details ? `: ${r.details}` : ''}`.slice(
                          0,
                          500
                        )
                      );
                      setBanFor(r);
                    }}
                    data-testid={`report-ban-${r.id}`}
                  >
                    {t('playersPage.ban')}
                  </Button>
                </Stack>
              )}
            </Row>
          ))}
        </RowList>
      )}

      <Dialog open={!!banFor} onClose={() => !busy && setBanFor(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {t('playersPage.banTitle', { name: banFor?.reported.name ?? '' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('playersPage.banBody')}
          </Typography>
          <TextField
            label={t('playersPage.banReason')}
            helperText={t('playersPage.banReasonHelp')}
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
            inputProps={{ maxLength: 500 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBanFor(null)} disabled={busy}>
            {t('playersPage.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            data-testid="report-ban-confirm"
            onClick={async () => {
              const r = banFor!;
              if (
                await act(
                  () =>
                    api.post(`/api/player-reports/${r.id}/ban`, {
                      reason: banReason.trim() || null,
                    }),
                  t('playersPage.bannedDone', { name: r.reported.name })
                )
              ) {
                setBanFor(null);
              }
            }}
          >
            {t('playersPage.ban')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
