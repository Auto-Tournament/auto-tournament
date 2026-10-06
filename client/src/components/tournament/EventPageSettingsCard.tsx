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
  FormControlLabel,
  Switch,
} from '@mui/material';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { EventPagePrize, EventPageScheduleItem, TournamentSettings } from '../../types';
import { TournamentBannerField } from './TournamentBannerField';

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
  | 'registrationOpen'
  | 'registrationClosesAt'
  | 'maxTeams'
  | 'checkInOpensAt'
  | 'checkInClosesAt'
  | 'skinRewards'
>;

/** An ISO time as the value a `datetime-local` input wants, in local time. */
function toLocalInput(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value back to ISO, or '' when empty. */
function fromLocalInput(value: string): string {
  return value ? new Date(value).toISOString() : '';
}

interface EventPageSettingsCardProps {
  settings: EventPageFields | undefined;
  saving: boolean;
  /** Saves straight to the tournament. Not used when `onDraftChange` is set. */
  onSave?: (patch: Record<string, unknown>) => Promise<unknown>;
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
  const [registrationOpen, setRegistrationOpen] = useState(settings?.registrationOpen ?? false);
  const [registrationClosesAt, setRegistrationClosesAt] = useState(toLocalInput(settings?.registrationClosesAt));
  const [maxTeams, setMaxTeams] = useState(settings?.maxTeams ? String(settings.maxTeams) : '');
  const [checkInOpensAt, setCheckInOpensAt] = useState(toLocalInput(settings?.checkInOpensAt));
  const [checkInClosesAt, setCheckInClosesAt] = useState(toLocalInput(settings?.checkInClosesAt));
  const [skinRewards, setSkinRewards] = useState(settings?.skinRewards !== false);
  const signupFields = () => ({
    registrationOpen,
    registrationClosesAt: fromLocalInput(registrationClosesAt),
    maxTeams: maxTeams ? Number(maxTeams) : null,
    checkInOpensAt: fromLocalInput(checkInOpensAt),
    checkInClosesAt: fromLocalInput(checkInClosesAt),
    skinRewards,
  });
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
      ...signupFields(),
    } as EventPageFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signupFields reads the five values listed
  }, [description, location, organizer, rulebookUrl, rules, prizes, schedule, registrationOpen, registrationClosesAt, maxTeams, checkInOpensAt, checkInClosesAt, skinRewards]);

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
        ...signupFields(),
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
      {onSave && !onDraftChange && <TournamentBannerField bannerUrl={bannerUrl} />}
      <Stack spacing={2} data-testid="event-page-signup">
        <Typography variant="subtitle2">{t('tournament.eventPage.signupHeading')}</Typography>
        <FormControlLabel
          control={
            <Switch
              checked={registrationOpen}
              onChange={(e) => setRegistrationOpen(e.target.checked)}
              inputProps={{ 'aria-label': t('tournament.eventPage.signupOpen') }}
            />
          }
          label={t('tournament.eventPage.signupOpen')}
        />
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              type="datetime-local"
              label={t('tournament.eventPage.signupClosesAt')}
              value={registrationClosesAt}
              onChange={(e) => setRegistrationClosesAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              type="number"
              label={t('tournament.eventPage.maxTeams')}
              value={maxTeams}
              onChange={(e) => setMaxTeams(e.target.value)}
              inputProps={{ min: 2, max: 256 }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              type="datetime-local"
              label={t('tournament.eventPage.checkInOpensAt')}
              value={checkInOpensAt}
              onChange={(e) => setCheckInOpensAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              type="datetime-local"
              label={t('tournament.eventPage.checkInClosesAt')}
              value={checkInClosesAt}
              onChange={(e) => setCheckInClosesAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
        </Grid>
        <Typography variant="caption" color="text.secondary">
          {t('tournament.eventPage.signupHelp')}
        </Typography>
        <FormControlLabel
          control={<Switch checked={skinRewards} onChange={(e) => setSkinRewards(e.target.checked)} />}
          label={t('tournament.eventPage.skinRewards')}
        />
      </Stack>
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
