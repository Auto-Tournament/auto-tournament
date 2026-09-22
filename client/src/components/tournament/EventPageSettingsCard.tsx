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
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { EventPagePrize, EventPageScheduleItem, TournamentSettings } from '../../types';

const MAX_RULES = 20;
const MAX_PRIZES = 5;
const MAX_SCHEDULE = 20;
const MAX_DESCRIPTION = 4000;
const MAX_LOCATION = 120;

/** The event page fields, as stored in the tournament settings. */
export type EventPageFields = Pick<
  TournamentSettings,
  'description' | 'location' | 'rulebookUrl' | 'rules' | 'prizes' | 'schedule'
>;

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
 * public Overview tab (description, location, rules, rulebook link, prizes,
 * schedule). Saves via the existing tournament PUT, which merges these into
 * the tournament's stored settings.
 */
export function EventPageSettingsCard({
  settings,
  saving,
  onSave,
  onDraftChange,
  variant = 'card',
}: EventPageSettingsCardProps) {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();

  const [description, setDescription] = useState(settings?.description ?? '');
  const [location, setLocation] = useState(settings?.location ?? '');
  const [rulebookUrl, setRulebookUrl] = useState(settings?.rulebookUrl ?? '');
  const [rules, setRules] = useState<string[]>(settings?.rules ?? []);
  const [prizes, setPrizes] = useState<EventPagePrize[]>(settings?.prizes ?? []);
  const [schedule, setSchedule] = useState<EventPageScheduleItem[]>(settings?.schedule ?? []);
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
    draftChangeRef.current?.({ description, location, rulebookUrl, rules, prizes, schedule });
  }, [description, location, rulebookUrl, rules, prizes, schedule]);

  const handleSave = async () => {
    if (!onSave) return;
    setLocalSaving(true);
    try {
      await onSave({
        description,
        location,
        rulebookUrl,
        rules,
        prizes,
        schedule,
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
      <TextField
        label={t('tournament.eventPage.descriptionLabel')}
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
        multiline
        minRows={3}
        fullWidth
        helperText={`${description.length}/${MAX_DESCRIPTION}`}
      />

      <TextField
        label={t('tournament.eventPage.locationLabel')}
        placeholder={t('tournament.eventPage.locationPlaceholder')}
        value={location}
        onChange={(e) => setLocation(e.target.value.slice(0, MAX_LOCATION))}
        fullWidth
        helperText={`${location.length}/${MAX_LOCATION}`}
      />

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
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setRules(move(rules, index, 1))}
                disabled={index === rules.length - 1}
                aria-label={t('tournament.eventPage.moveDown')}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                color="error"
                onClick={() => setRules(rules.filter((_, i) => i !== index))}
                aria-label={t('tournament.eventPage.remove')}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Stack>
        <Button
          size="small"
          startIcon={<AddIcon />}
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
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Grid>
            </Grid>
          ))}
        </Stack>
        <Button
          size="small"
          startIcon={<AddIcon />}
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
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Grid>
            </Grid>
          ))}
        </Stack>
        <Button
          size="small"
          startIcon={<AddIcon />}
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
