import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { DotsThreeIcon, PlusIcon, StarIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { eliminationRoundCount, getRoundLabel } from '../utils/matchUtils';
import { PageHead } from '../components/common/ui';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { useAdminTournament, type TournamentListItem } from '../contexts/AdminTournamentContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { paths, tournamentTabPath } from '../paths';
import { tokens, radii, fontMono } from '../theme/tokens';
import { api } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';

const { color } = tokens;

function statusTone(t: TournamentListItem): { label: string; fg: string; bg: string } {
  if (t.status === 'in_progress') return { label: 'live', fg: color.live, bg: color.paper3 };
  if (t.status === 'completed') return { label: 'finished', fg: color.medalGold, bg: color.paper3 };
  if (t.registrationOpen) return { label: 'signup', fg: color.accent, bg: color.paper3 };
  return { label: 'draft', fg: color.ink2, bg: color.paper3 };
}

/** "semis", "round 2": the stage a running tournament is at. */
function stageOf(t: TournamentListItem, tr: TFunction): string | null {
  if (t.status !== 'in_progress' || !t.currentRound) return null;
  return t.type === 'single_elimination' || t.type === 'double_elimination'
    ? getRoundLabel(t.currentRound, eliminationRoundCount(t.entries, t.type as never)).toLowerCase()
    : tr('tournamentsPage.round', { n: t.currentRound });
}

/** "Today, from 13:00", "Tomorrow, 18:00", "Fri 9 Oct, 20:00"; empty without a date. */
function when(t: TournamentListItem, locale: string, tr: TFunction): string {
  const at = t.status === 'completed' ? t.completedAt : (t.startsAt ?? t.startedAt);
  if (!at) return '';
  const date = new Date(at * 1000);
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (t.status === 'completed') return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  if (diff === 0) return tr('tournamentsPage.whenToday', { time });
  if (diff === 1) return tr('tournamentsPage.whenTomorrow', { time });
  return date.toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Admin: every tournament (board 4 of the front page drafts). Several can run
 * at once; the rail's switcher picks the one the other admin pages act on.
 * New tournament starts blank or copies one.
 */
export default function Tournaments() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useSnackbar();
  const { tournaments, selectedId, featuredId, nextId, select, reload } = useAdminTournament();
  const [menu, setMenu] = useState<{ anchor: HTMLElement; item: TournamentListItem } | null>(null);
  const [deleting, setDeleting] = useState<TournamentListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = tournaments.filter((x) => x.status === 'in_progress').length;

  useEffect(() => {
    document.title = pageTitle(t('tournamentsPage.title'));
    void reload();
  }, [t, reload]);

  const open = (id: number) => {
    select(id);
    navigate(paths.tournament);
  };

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      showSuccess(done);
      await reload();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setMenu(null);
    }
  };

  return (
    <Box data-testid="tournaments-page">
      <PageHead
        title={t('tournamentsPage.title')}
        subtitle={live > 1 ? t('tournamentsPage.liveShared', { count: live }) : t('tournamentsPage.subtitle')}
        actions={
          <Button variant="contained" startIcon={<PlusIcon />} onClick={() => setCreating(true)} data-testid="tournaments-new">
            {t('tournamentsPage.new')}
          </Button>
        }
      />

      {tournaments.length === 0 ? (
        <Box
          data-testid="tournaments-empty"
          sx={{ border: `1px dashed ${color.rule}`, borderRadius: radii.lg, p: { xs: 3, md: 5 }, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1.5 }}
        >
          <Typography sx={{ fontWeight: 600 }}>{t('tournamentsPage.emptyTitle')}</Typography>
          <Typography color="text.secondary">{t('tournamentsPage.empty')}</Typography>
          <Button variant="contained" startIcon={<PlusIcon />} onClick={() => setCreating(true)}>
            {t('tournamentsPage.new')}
          </Button>
        </Box>
      ) : (
        <Box role="table" aria-label={t('tournamentsPage.title')} sx={{ border: `1px solid ${color.rule}`, borderRadius: radii.lg, overflow: 'hidden' }}>
          <Box role="row" sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: 'minmax(0, 1.6fr) 150px 190px 110px 120px 44px', gap: 2, px: 2.5, py: 1.5, bgcolor: color.paper2, fontSize: '0.8125rem', color: color.muted }}>
            <span role="columnheader">{t('tournamentsPage.col.name')}</span>
            <span role="columnheader">{t('tournamentsPage.col.status')}</span>
            <span role="columnheader">{t('tournamentsPage.col.when')}</span>
            <span role="columnheader">{t('tournamentsPage.col.entries')}</span>
            <span role="columnheader">{t('tournamentsPage.col.frontPage')}</span>
            <span role="columnheader" aria-label={t('tournamentsPage.col.actions')} />
          </Box>
          {tournaments.map((x) => {
            const tone = statusTone(x);
            const selected = x.id === selectedId;
            return (
              <Box
                role="row"
                key={x.id}
                data-testid={`tournaments-row-${x.id}`}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1.6fr) 150px 190px 110px 120px 44px' },
                  gap: 2,
                  px: 2.5,
                  py: 2,
                  alignItems: 'center',
                  borderTop: `1px solid ${color.rule}`,
                  bgcolor: selected ? color.paper2 : 'transparent',
                }}
              >
                <Box role="cell" sx={{ minWidth: 0 }}>
                  <Box component="button" type="button" onClick={() => open(x.id)} sx={{ all: 'unset', cursor: 'pointer', fontWeight: 600, color: color.ink, '&:focus-visible': { outline: `2px solid ${color.focus}` } }}>
                    {x.name}
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {[x.teamSize ? `${x.teamSize}v${x.teamSize}` : x.format.toUpperCase(), t(`tournament.typeSelector.types.${x.type}.label`, { defaultValue: x.type }), x.winner ? t('tournamentsPage.won', { name: x.winner.name }) : null, selected ? t('tournamentsPage.selected') : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
                <Box role="cell" sx={{ display: { xs: 'none', md: 'block' } }}>
                  <Box component="span" sx={{ px: 1.25, py: 0.5, borderRadius: radii.pill, bgcolor: tone.bg, color: tone.fg, fontSize: '0.8125rem', fontWeight: 600 }}>
                    {t(`tournamentsPage.status.${tone.label}`)}
                    {stageOf(x, t) ? ` · ${stageOf(x, t)}` : ''}
                  </Box>
                </Box>
                <Box role="cell" sx={{ display: { xs: 'none', md: 'block' }, fontSize: '0.875rem', color: color.ink2 }}>{when(x, i18n.language, t) || t('tournamentsPage.notSet')}</Box>
                <Box role="cell" sx={{ display: { xs: 'none', md: 'block' }, fontFamily: fontMono, fontSize: '0.875rem' }}>
                  {x.maxEntries ? `${x.entries} / ${x.maxEntries}` : x.entries}
                </Box>
                <Box role="cell" sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.75, fontSize: '0.875rem', color: x.id === featuredId ? color.medalGold : color.ink2 }}>
                  {x.id === featuredId && <StarIcon weight="fill" size={16} />}
                  {x.status === 'completed' && x.id !== featuredId ? (
                    <Box
                      component={RouterLink}
                      to={tournamentTabPath(x.id, 'standings')}
                      data-testid={`tournaments-results-${x.id}`}
                      sx={{ color: color.medalGold, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                    >
                      {t('tournamentsPage.front.results')}
                    </Box>
                  ) : x.id === featuredId
                    ? t('tournamentsPage.front.featured')
                    : x.archived
                      ? t('tournamentsPage.front.archived')
                      : x.draft
                        ? t('tournamentsPage.front.hidden')
                        : t('tournamentsPage.front.shown')}
                </Box>
                <IconButton aria-label={t('tournamentsPage.more', { name: x.name })} onClick={(e) => setMenu({ anchor: e.currentTarget, item: x })} data-testid={`tournaments-more-${x.id}`}>
                  <DotsThreeIcon />
                </IconButton>
              </Box>
            );
          })}
        </Box>
      )}

      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem key="open" onClick={() => open(menu.item.id)}>{t('tournamentsPage.menu.open')}</MenuItem>,
          <MenuItem key="page" onClick={() => navigate(tournamentTabPath(menu.item.id))}>{t('tournamentsPage.menu.page')}</MenuItem>,
          menu.item.id !== featuredId ? (
            <MenuItem key="feature" disabled={busy} onClick={() => void run(() => api.put(`/api/tournaments/${menu.item.id}/feature`, {}), t('tournamentsPage.toast.featured'))}>
              {t('tournamentsPage.menu.feature')}
            </MenuItem>
          ) : null,
          menu.item.status === 'completed' && !menu.item.archived ? (
            <MenuItem key="archive" disabled={busy} onClick={() => void run(() => api.post(`/api/tournaments/${menu.item.id}/archive`, {}), t('tournamentsPage.toast.archived'))}>
              {t('tournamentsPage.menu.archive')}
            </MenuItem>
          ) : null,
          <MenuItem key="delete" sx={{ color: 'error.main' }} onClick={() => { setDeleting(menu.item); setMenu(null); }}>
            {t('tournamentsPage.menu.delete')}
          </MenuItem>,
        ]}
      </Menu>

      <ConfirmDialog
        open={deleting !== null}
        title={t('tournamentsPage.deleteTitle')}
        message={t('tournamentsPage.deleteMessage', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        confirmColor="error"
        loading={busy}
        onConfirm={() =>
          deleting &&
          void run(() => api.fetch('/api/tournament?keepPlayed=1', { method: 'DELETE', headers: { 'X-Tournament-Id': String(deleting.id) } }), t('tournamentsPage.toast.deleted')).then(() => setDeleting(null))
        }
        onCancel={() => setDeleting(null)}
      />

      <NewTournamentDialog
        open={creating}
        onClose={() => setCreating(false)}
        tournaments={tournaments}
        onBlank={(name) => {
          setCreating(false);
          if (nextId) select(nextId);
          navigate(name ? `${paths.tournament}?name=${encodeURIComponent(name)}` : paths.tournament);
        }}
        onTemplate={(templateId, name) => {
          setCreating(false);
          if (nextId) select(nextId);
          navigate(`${paths.tournament}?template=${templateId}${name ? `&name=${encodeURIComponent(name)}` : ''}`);
        }}
        onCopied={async (id) => {
          setCreating(false);
          await reload();
          select(id);
          navigate(paths.tournament);
        }}
      />
    </Box>
  );
}

/** New tournament (board 4b): a name, then where to start from: blank, a template or a copy. */
function NewTournamentDialog({
  open,
  onClose,
  tournaments,
  onBlank,
  onTemplate,
  onCopied,
}: {
  open: boolean;
  onClose: () => void;
  tournaments: TournamentListItem[];
  onBlank: (name: string) => void;
  onTemplate: (templateId: number, name: string) => void;
  onCopied: (id: number) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [name, setName] = useState('');
  const [from, setFrom] = useState<'blank' | 'template' | 'copy'>('blank');
  const [templates, setTemplates] = useState<Array<{ id: number; name: string; format?: string; type?: string }>>([]);
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [copyId, setCopyId] = useState<number | ''>(tournaments[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get<{ templates: Array<{ id: number; name: string; format?: string; type?: string }> }>('/api/templates')
      .then((r) => {
        if (cancelled) return;
        setTemplates(r.templates ?? []);
        setTemplateId((current) => current || (r.templates?.[0]?.id ?? ''));
      })
      .catch(() => !cancelled && setTemplates([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const create = async () => {
    if (from === 'blank') {
      onBlank(name.trim());
      return;
    }
    if (from === 'template') {
      if (templateId) onTemplate(Number(templateId), name.trim());
      return;
    }
    if (!copyId) return;
    setBusy(true);
    try {
      const r = await api.post<{ tournament: { id: number } }>('/api/tournaments', {
        copyFrom: Number(copyId),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      await onCopied(r.tournament.id);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const option = (value: 'blank' | 'template' | 'copy', title: string, hint: string, extra?: React.ReactNode) => (
    <Box
      sx={{ p: 1.5, borderRadius: radii.md, border: `1px solid ${from === value ? color.accent : color.rule}`, bgcolor: from === value ? color.paper2 : 'transparent' }}
    >
      <FormControlLabel
        value={value}
        control={<Radio />}
        label={
          <Box>
            <Typography fontWeight={600}>{title}</Typography>
            <Typography variant="caption" color="text.secondary">
              {hint}
            </Typography>
          </Box>
        }
        sx={{ m: 0, alignItems: 'flex-start', '& .MuiRadio-root': { pt: 0.25 } }}
      />
      {from === value && extra ? <Box sx={{ mt: 1.25, pl: 4.5 }}>{extra}</Box> : null}
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="new-tournament-dialog">
      <DialogTitle>{t('tournamentsPage.new')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2.5, pt: '8px !important' }}>
        <TextField
          label={t('tournamentsPage.newName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          fullWidth
          inputProps={{ maxLength: 100, 'data-testid': 'new-tournament-name' }}
        />
        <RadioGroup value={from} onChange={(e) => setFrom(e.target.value as typeof from)} aria-label={t('tournamentsPage.startFrom')} sx={{ display: 'grid', gap: 1 }}>
          {option('blank', t('tournamentsPage.blank'), t('tournamentsPage.blankHint'))}
          {templates.length > 0 &&
            option(
              'template',
              t('tournamentsPage.template'),
              t('tournamentsPage.templateHint'),
              <TextField
                select
                size="small"
                fullWidth
                label={t('tournamentsPage.template')}
                value={templateId}
                onChange={(e) => setTemplateId(Number(e.target.value))}
                inputProps={{ 'data-testid': 'new-tournament-template' }}
              >
                {templates.map((tpl) => (
                  <MenuItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          {tournaments.length > 0 &&
            option(
              'copy',
              t('tournamentsPage.copyOne'),
              t('tournamentsPage.copyHint'),
              <TextField
                select
                size="small"
                fullWidth
                label={t('tournamentsPage.copyWhich')}
                value={copyId}
                onChange={(e) => setCopyId(Number(e.target.value))}
                inputProps={{ 'data-testid': 'new-tournament-copy' }}
              >
                {tournaments.map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => void create()} disabled={busy} data-testid="new-tournament-create">
          {t('tournamentsPage.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
