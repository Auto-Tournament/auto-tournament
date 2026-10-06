/**
 * How teams get into a tournament, on the setup's "Teams and sign-up" step:
 * only the teams the organizer adds, or also teams that sign themselves up
 * (with the sign-up and check-in windows, team spots and players per team).
 * The organizer can add teams by hand either way.
 *
 * Before the tournament exists the values live in the setup form and go out
 * with the create request; once it exists they save on their own (Save).
 */
import { useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from './SegmentedControl';
import type { TournamentSettings } from '../../../types';

export interface SignupFields {
  registrationOpen: boolean;
  registrationClosesAt: string;
  maxTeams: number | null;
  checkInOpensAt: string;
  checkInClosesAt: string;
  /** Players per team: how many starters a team picks when it signs up. */
  teamSize: number;
}

export const DEFAULT_SIGNUP: SignupFields = {
  registrationOpen: false,
  registrationClosesAt: '',
  maxTeams: null,
  checkInOpensAt: '',
  checkInClosesAt: '',
  teamSize: 5,
};

/** A saved tournament's sign-up fields. */
export function signupOf(settings: TournamentSettings | undefined, teamSize: number | undefined): SignupFields {
  return {
    registrationOpen: settings?.registrationOpen === true,
    registrationClosesAt: settings?.registrationClosesAt ?? '',
    maxTeams: settings?.maxTeams ?? null,
    checkInOpensAt: settings?.checkInOpensAt ?? '',
    checkInClosesAt: settings?.checkInClosesAt ?? '',
    teamSize: teamSize ?? 5,
  };
}

/** The fields as the tournament's settings store them (teamSize goes separately). */
export function signupSettingsPatch(fields: SignupFields): Partial<TournamentSettings> {
  return {
    registrationOpen: fields.registrationOpen,
    registrationClosesAt: fields.registrationClosesAt,
    maxTeams: fields.maxTeams,
    checkInOpensAt: fields.checkInOpensAt,
    checkInClosesAt: fields.checkInClosesAt,
  } as Partial<TournamentSettings>;
}

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

interface SignupSettingsProps {
  value: SignupFields;
  onChange: (next: SignupFields) => void;
  disabled?: boolean;
  /** A saved tournament: a Save button, enabled while `dirty`. */
  onSave?: () => void;
  dirty?: boolean;
  saving?: boolean;
}

export function SignupSettings({ value, onChange, disabled, onSave, dirty, saving }: SignupSettingsProps) {
  const { t } = useTranslation();
  const set = (patch: Partial<SignupFields>) => onChange({ ...value, ...patch });
  const dateField = (key: 'registrationClosesAt' | 'checkInOpensAt' | 'checkInClosesAt', label: string) => (
    <TextField
      fullWidth
      type="datetime-local"
      label={label}
      value={toLocalInput(value[key])}
      onChange={(e) => set({ [key]: fromLocalInput(e.target.value) })}
      InputLabelProps={{ shrink: true }}
      disabled={disabled}
      inputProps={{ 'data-testid': `signup-${key}` }}
    />
  );

  return (
    <Stack spacing={2} data-testid="setup-signup">
      <SegmentedControl
        label={t('tournament.setup.signup.how')}
        value={value.registrationOpen ? 'signup' : 'organizer'}
        onChange={(mode) => set({ registrationOpen: mode === 'signup' })}
        disabled={disabled}
        testId="setup-signup-mode"
        options={[
          { value: 'organizer', label: t('tournament.setup.signup.organizer'), testId: 'setup-signup-organizer' },
          { value: 'signup', label: t('tournament.setup.signup.open'), testId: 'setup-signup-open' },
        ]}
      />
      <Typography variant="body2" color="text.secondary">
        {value.registrationOpen ? t('tournament.setup.signup.openHelp') : t('tournament.setup.signup.organizerHelp')}
      </Typography>
      {value.registrationOpen && (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
          <TextField
            fullWidth
            type="number"
            label={t('tournament.setup.signup.teamSize')}
            value={value.teamSize}
            onChange={(e) => set({ teamSize: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
            inputProps={{ min: 1, max: 10, 'data-testid': 'signup-teamSize' }}
            helperText={t('tournament.setup.signup.teamSizeHelp')}
            disabled={disabled}
          />
          <TextField
            fullWidth
            type="number"
            label={t('tournament.eventPage.maxTeams')}
            value={value.maxTeams ?? ''}
            onChange={(e) => set({ maxTeams: e.target.value ? Number(e.target.value) : null })}
            inputProps={{ min: 2, max: 256, 'data-testid': 'signup-maxTeams' }}
            helperText={t('tournament.setup.signup.maxTeamsHelp')}
            disabled={disabled}
          />
          {dateField('registrationClosesAt', t('tournament.eventPage.signupClosesAt'))}
          {dateField('checkInOpensAt', t('tournament.eventPage.checkInOpensAt'))}
          {dateField('checkInClosesAt', t('tournament.eventPage.checkInClosesAt'))}
        </Box>
      )}
      {onSave && (
        <Box>
          <Button variant="outlined" onClick={onSave} disabled={!dirty || saving || disabled} data-testid="setup-signup-save">
            {t('tournament.setup.signup.save')}
          </Button>
        </Box>
      )}
    </Stack>
  );
}

/** For a saved tournament: the fields held locally until Save. */
export function useSavedSignup(initial: SignupFields) {
  const [value, setValue] = useState(initial);
  const [base, setBase] = useState(initial);
  // The saved values changed on the server (our own save, another tab): start over from them.
  const key = JSON.stringify(initial);
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setBase(initial);
    setValue(initial);
  }
  return { value, setValue, dirty: JSON.stringify(value) !== JSON.stringify(base) };
}
