import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Stack,
  IconButton,
  Divider,
  Grid,
  Chip,
} from '@mui/material';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { EventPagePrize, EventPageScheduleItem, TournamentSettings } from '../../types';
import { TournamentBannerField } from './TournamentBannerField';
import { FALLBACK_ART_MAPS } from '../../utils/tournamentArt';
import { SwitchRow } from '../../components/common/ui';
import type { Untrusted } from '../../utils/untrusted';

const MAX_RULES = 20;
const MAX_PRIZES = 5;
const MAX_SCHEDULE = 20;
const MAX_DESCRIPTION = 4000;
const MAX_LOCATION = 120;
const MAX_ORGANIZER = 80;

/** The event page fields, as stored in the tournament settings. */
export type EventPageFields = Pick<
  TournamentSettings,
  | 'description'
  | 'location'
  | 'organizer'
  | 'rulebookUrl'
  | 'rules'
  | 'prizes'
  | 'schedule'
  | 'startsAt'
  | 'autoStart'
  | 'startReminders'
>;

interface EventPageSettingsCardProps {
  settings: EventPageFields | undefined;
  saving: boolean;
  /** Saves straight to the tournament. Not used when `onDraftChange` is set. */
  onSave?: (patch: Record<string, Untrusted>) => Promise<Untrusted>;
  /**
   * Draft mode, before the tournament exists: every edit is reported here and
   * the fields are sent with the create request. No Save button.
   */
  onDraftChange?: (fields: EventPageFields) => void;
  /** 'embedded' drops the card chrome and heading, for use inside a setup step. */
  variant?: 'card' | 'embedded';
  /** The tournament's banner. Shown (with Upload) only once the tournament exists. */
  bannerUrl?: string | null;
}

const REMINDER_CHOICES = [60, 30, 15, 5];
const DEFAULT_REMINDERS = [60, 30, 5];

/** An ISO time as the value of a datetime-local input, in the viewer's own time zone. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Reorder helper: move an array item up (-1) or down (+1), clamped to bounds. */
function move<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Admin "Event page" section: the organizer-written content shown on the
 * public Overview tab (description, location, organizer, rules, rulebook link, prizes,
 * schedule). Saves via the existing tournament PUT, which merges these into
 * the tournament's stored settings.
 */
export function EventPageSettingsCard({
  settings,
  saving,
  onSave,
  onDraftChange,
  variant = 'card',
  bannerUrl,
}: EventPageSettingsCardProps) {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();

  const [description, setDescription] = useState(settings?.description ?? '');
  const [location, setLocation] = useState(settings?.location ?? '');
  const [organizer, setOrganizer] = useState(settings?.organizer ?? '');
  const [rulebookUrl, setRulebookUrl] = useState(settings?.rulebookUrl ?? '');
  const [rules, setRules] = useState<string[]>(settings?.rules ?? []);
  const [prizes, setPrizes] = useState<EventPagePrize[]>(settings?.prizes ?? []);
  const [schedule, setSchedule] = useState<EventPageScheduleItem[]>(settings?.schedule ?? []);
  const [startsAt, setStartsAt] = useState(settings?.startsAt ?? '');
  const [autoStart, setAutoStart] = useState(settings?.autoStart === true);
  const [reminders, setReminders] = useState<number[]>(
    settings?.startReminders ?? DEFAULT_REMINDERS
  );
  const [localSaving, setLocalSaving] = useState(false);

  // Draft mode: report every edit (but not the initial values) to the parent.
  const draftChangeRef = useRef(onDraftChange);
  draftChangeRef.current = onDraftChange;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    draftChangeRef.current?.({
      description,
      location,
      organizer,
      rulebookUrl,
      rules,
      prizes,
      schedule,
      startsAt: startsAt || undefined,
      autoStart: autoStart && !!startsAt,
      startReminders: reminders,
    } as EventPageFields);
  }, [
    description,
    location,
    organizer,
    rulebookUrl,
    rules,
    prizes,
    schedule,
    startsAt,
    autoStart,
    reminders,
  ]);

  const handleSave = async () => {
    if (!onSave) return;
    setLocalSaving(true);
    try {
      await onSave({
        description,
        location,
        organizer,
        rulebookUrl,
        rules,
        prizes,
        schedule,
        startsAt: startsAt || '',
        autoStart: autoStart && !!startsAt,
        startReminders: reminders,
      });
      showSuccess(t('tournament.eventPage.saveSuccess'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showError(t('tournament.eventPage.saveError', { message }));
    } finally {
      setLocalSaving(false);
    }
  };

  const isSaving = saving || localSaving;

  const fields = (
    <Stack spacing={3}>
      {onSave && !onDraftChange && (
        <TournamentBannerField
          bannerUrl={bannerUrl}
          bannerMap={(settings as { bannerMap?: string } | undefined)?.bannerMap ?? null}
          maps={
            (settings as { cs2?: { maps?: string[] } } | undefined)?.cs2?.maps ?? FALLBACK_ART_MAPS
          }
        />
      )}
      <TextField
        label={t('tournament.eventPage.descriptionLabel')}
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
        multiline
        minRows={3}
        fullWidth
        helperText={`${description.length}/${MAX_DESCRIPTION}`}
      />

      {/* Short fields that belong together share a row where there is room. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
          gap: 3,
        }}
      >
        <TextField
          label={t('tournament.eventPage.locationLabel')}
          placeholder={t('tournament.eventPage.locationPlaceholder')}
          value={location}
          onChange={(e) => setLocation(e.target.value.slice(0, MAX_LOCATION))}
          fullWidth
          helperText={`${location.length}/${MAX_LOCATION}`}
        />

        <TextField
          label={t('tournament.eventPage.organizerLabel')}
          placeholder={t('tournament.eventPage.organizerPlaceholder')}
          value={organizer}
          onChange={(e) => setOrganizer(e.target.value.slice(0, MAX_ORGANIZER))}
          fullWidth
          helperText={`${organizer.length}/${MAX_ORGANIZER}`}
          inputProps={{ 'data-testid': 'event-page-organizer' }}
        />
      </Box>

      <TextField
        label={t('tournament.eventPage.rulebookUrlLabel')}
        helperText={t('tournament.eventPage.rulebookUrlHelper')}
        value={rulebookUrl}
        onChange={(e) => setRulebookUrl(e.target.value)}
        fullWidth
      />

      <Divider />

      {/* Rules */}
      <Box>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          {t('tournament.eventPage.rulesLabel')}
        </Typography>
        <Stack spacing={1.5}>
          {rules.map((rule, index) => (
            <Box key={index} display="flex" gap={1} alignItems="center">
              <TextField
                size="small"
                fullWidth
                label={t('tournament.eventPage.ruleFieldLabel', { n: index + 1 })}
                value={rule}
                onChange={(e) => {
                  const next = [...rules];
                  next[index] = e.target.value.slice(0, 500);
                  setRules(next);
                }}
              />
              <IconButton
                size="small"
                onClick={() => setRules(move(rules, index, -1))}
                disabled={index === 0}
                aria-label={t('tournament.eventPage.moveUp')}
              >
                <ArrowUpIcon size={20} />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setRules(move(rules, index, 1))}
                disabled={index === rules.length - 1}
                aria-label={t('tournament.eventPage.moveDown')}
              >
                <ArrowDownIcon size={20} />
              </IconButton>
              <IconButton
                size="small"
                color="error"
                onClick={() => setRules(rules.filter((_, i) => i !== index))}
                aria-label={t('tournament.eventPage.remove')}
              >
                <TrashIcon size={20} />
              </IconButton>
            </Box>
          ))}
        </Stack>
        <Button
          size="small"
          startIcon={<PlusIcon />}
          onClick={() => setRules([...rules, ''])}
          disabled={rules.length >= MAX_RULES}
          sx={{ mt: 1 }}
        >
          {t('tournament.eventPage.addRule')}
        </Button>
      </Box>

      <Divider />

      {/* Prizes */}
      <Box>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          {t('tournament.eventPage.prizesLabel')}
        </Typography>
        <Stack spacing={1.5}>
          {prizes.map((prize, index) => (
            <Grid container spacing={1} key={index} alignItems="center">
              <Grid size={{ xs: 4 }}>
                <TextField
                  size="small"
                  fullWidth
                  label={t('tournament.eventPage.placeLabel')}
                  value={prize.place}
                  onChange={(e) => {
                    const next = [...prizes];
                    next[index] = { ...next[index], place: e.target.value.slice(0, 40) };
                    setPrizes(next);
                  }}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  size="small"
                  fullWidth
                  label={t('tournament.eventPage.prizeLabel')}
                  value={prize.prize}
                  onChange={(e) => {
                    const next = [...prizes];
                    next[index] = { ...next[index], prize: e.target.value.slice(0, 200) };
                    setPrizes(next);
                  }}
                />
              </Grid>
              <Grid size={{ xs: 2 }}>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setPrizes(prizes.filter((_, i) => i !== index))}
                  aria-label={t('tournament.eventPage.remove')}
                >
                  <TrashIcon size={20} />
                </IconButton>
              </Grid>
            </Grid>
          ))}
        </Stack>
        <Button
          size="small"
          startIcon={<PlusIcon />}
          onClick={() => setPrizes([...prizes, { place: '', prize: '' }])}
          disabled={prizes.length >= MAX_PRIZES}
          sx={{ mt: 1 }}
        >
          {t('tournament.eventPage.addPrize')}
        </Button>
      </Box>

      <Divider />

      {/* Start time: a countdown on the site, reminders to the players, optionally the start itself */}
      <Box>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          {t('tournament.eventPage.startLabel')}
        </Typography>
        <Stack spacing={1.5}>
          <TextField
            size="small"
            type="datetime-local"
            label={t('tournament.eventPage.startsAtLabel')}
            InputLabelProps={{ shrink: true }}
            value={toLocalInput(startsAt)}
            onChange={(e) =>
              setStartsAt(e.target.value ? new Date(e.target.value).toISOString() : '')
            }
            helperText={t('tournament.eventPage.startsAtHelp')}
            sx={{ maxWidth: 320 }}
            inputProps={{ 'data-testid': 'event-starts-at' }}
          />
          <SwitchRow
            label={t('tournament.eventPage.autoStartLabel')}
            checked={autoStart && !!startsAt}
            disabled={!startsAt}
            onChange={(e) => setAutoStart(e.target.checked)}
            data-testid="event-auto-start"
          />
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('tournament.eventPage.remindersLabel')}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {REMINDER_CHOICES.map((m) => {
                const on = reminders.includes(m);
                return (
                  <Chip
                    key={m}
                    label={t('tournament.eventPage.reminderMinutes', { count: m })}
                    color={on ? 'primary' : 'default'}
                    variant={on ? 'filled' : 'outlined'}
                    onClick={() =>
                      setReminders(
                        on
                          ? reminders.filter((x) => x !== m)
                          : [...reminders, m].sort((a, b) => b - a)
                      )
                    }
                    disabled={!startsAt}
                  />
                );
              })}
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Divider />

      {/* Schedule */}
      <Box>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          {t('tournament.eventPage.scheduleLabel')}
        </Typography>
        <Stack spacing={1.5}>
          {schedule.map((item, index) => (
            <Grid container spacing={1} key={index} alignItems="center">
              <Grid size={{ xs: 4 }}>
                <TextField
                  size="small"
                  fullWidth
                  type="datetime-local"
                  label={t('tournament.eventPage.whenLabel')}
                  InputLabelProps={{ shrink: true }}
                  value={item.at ? item.at.slice(0, 16) : ''}
                  onChange={(e) => {
                    const next = [...schedule];
                    const iso = e.target.value ? new Date(e.target.value).toISOString() : '';
                    next[index] = { ...next[index], at: iso };
                    setSchedule(next);
                  }}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  size="small"
                  fullWidth
                  label={t('tournament.eventPage.scheduleLabelLabel')}
                  value={item.label}
                  onChange={(e) => {
                    const next = [...schedule];
                    next[index] = { ...next[index], label: e.target.value.slice(0, 200) };
                    setSchedule(next);
                  }}
                />
              </Grid>
              <Grid size={{ xs: 2 }}>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setSchedule(schedule.filter((_, i) => i !== index))}
                  aria-label={t('tournament.eventPage.remove')}
                >
                  <TrashIcon size={20} />
                </IconButton>
              </Grid>
            </Grid>
          ))}
        </Stack>
        <Button
          size="small"
          startIcon={<PlusIcon />}
          onClick={() => setSchedule([...schedule, { at: new Date().toISOString(), label: '' }])}
          disabled={schedule.length >= MAX_SCHEDULE}
          sx={{ mt: 1 }}
        >
          {t('tournament.eventPage.addScheduleItem')}
        </Button>
      </Box>

      {onSave && !onDraftChange && (
        <Box>
          <Button variant="contained" onClick={handleSave} disabled={isSaving}>
            {t('tournament.eventPage.save')}
          </Button>
        </Box>
      )}
    </Stack>
  );

  if (variant === 'embedded') {
    return <Box data-testid="event-page-settings-card">{fields}</Box>;
  }

  return (
    <Card sx={{ mt: 3 }} data-testid="event-page-settings-card">
      <CardContent>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          {t('tournament.eventPage.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('tournament.eventPage.subtitle')}
        </Typography>
        {fields}
      </CardContent>
    </Card>
  );
}
