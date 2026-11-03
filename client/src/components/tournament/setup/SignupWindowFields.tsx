/**
 * The sign-up window and check-in (Claude Design, Setup › Teams): sign-up
 * opens now or at a set time and closes at a set time; check-in opens some
 * minutes before the start and closes when the tournament starts; captains may
 * check in their teammates.
 */
import { useState } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { ClockIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from './SegmentedControl';
import { DateTimeField } from '../../common/DatePicker';
import { SwitchRow } from '../../common/ui';
import { radii, tokens } from '../../../theme/tokens';
import type { SignupFields } from './SignupSettings';

const CHECK_IN_CHOICES = [60, 30, 15, 0];

export function SignupWindowFields({
  value,
  onChange,
  startsAt,
  disabled,
}: {
  value: SignupFields;
  onChange: (patch: Partial<SignupFields>) => void;
  startsAt?: string;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [later, setLater] = useState(Boolean(value.registrationOpensAt));
  const minutes = value.checkInMinutes;
  const choices = CHECK_IN_CHOICES.includes(minutes)
    ? CHECK_IN_CHOICES
    : [minutes, ...CHECK_IN_CHOICES];
  const start = startsAt ? new Date(startsAt) : null;
  const lang = i18n.language || 'en';
  const hhmm = (d: Date) => d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const line = (() => {
    if (minutes === 0) return t('tournament.setup.signup.checkInLineOff');
    if (!start || Number.isNaN(start.getTime()))
      return t('tournament.setup.signup.checkInLineNoStart', { count: minutes });
    const opens = new Date(start.getTime() - minutes * 60_000);
    return t('tournament.setup.signup.checkInLine', {
      day: opens.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }),
      time: hhmm(opens),
      start: hhmm(start),
    });
  })();
  const label = { fontSize: '0.8125rem', color: tokens.color.ink2 } as const;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Typography component="h2" variant="h6" fontWeight={600}>
          {t('tournament.setup.signup.windowTitle')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.75, alignItems: 'flex-start' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={label}>{t('tournament.setup.signup.opensLabel')}</Typography>
            <SegmentedControl
              label={t('tournament.setup.signup.opensLabel')}
              value={later ? 'later' : 'now'}
              onChange={(v) => {
                setLater(v === 'later');
                if (v === 'now') onChange({ registrationOpensAt: '' });
              }}
              disabled={disabled}
              testId="signup-opens-mode"
              options={[
                { value: 'now', label: t('tournament.setup.signup.opensNow') },
                { value: 'later', label: t('tournament.setup.signup.opensLater') },
              ]}
            />
            {later && (
              <DateTimeField
                label={t('tournament.setup.signup.opensLabel')}
                value={value.registrationOpensAt}
                onChange={(iso) => onChange({ registrationOpensAt: iso })}
                disabled={disabled}
                testId="signup-registrationOpensAt"
              />
            )}
            <Typography variant="caption" color="text.secondary">
              {later
                ? t('tournament.setup.signup.opensLaterHelp')
                : t('tournament.setup.signup.opensNowHelp')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={label}>{t('tournament.eventPage.signupClosesAt')}</Typography>
            <DateTimeField
              label={t('tournament.eventPage.signupClosesAt')}
              value={value.registrationClosesAt}
              onChange={(iso) => onChange({ registrationClosesAt: iso })}
              disabled={disabled}
              testId="signup-registrationClosesAt"
            />
            <Typography variant="caption" color="text.secondary">
              {t('tournament.setup.signup.closesHelp')}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Typography component="h2" variant="h6" fontWeight={600}>
          {t('tournament.setup.signup.checkInTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('tournament.setup.signup.checkInHelp')}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          role="radiogroup"
          aria-label={t('tournament.setup.signup.checkInTitle')}
        >
          {choices.map((m) => (
            <Chip
              key={m}
              role="radio"
              aria-checked={m === minutes}
              label={
                m === 0
                  ? t('tournament.setup.signup.checkInOff')
                  : t('tournament.setup.signup.checkInChip', { count: m })
              }
              color={m === minutes ? 'primary' : 'default'}
              variant={m === minutes ? 'filled' : 'outlined'}
              disabled={disabled}
              onClick={() => onChange({ checkInMinutes: m })}
              data-testid={`signup-checkin-${m}`}
            />
          ))}
        </Stack>
        <Box
          data-testid="signup-checkin-line"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            px: 1.75,
            py: 1.5,
            borderRadius: radii.md,
            border: `1px solid ${tokens.color.rule}`,
            bgcolor: tokens.color.paper2,
          }}
        >
          <ClockIcon size={18} aria-hidden />
          <Typography variant="body2">{line}</Typography>
        </Box>
        {minutes > 0 && (
          <SwitchRow
            label={
              <Box>
                <Typography fontWeight={600}>
                  {t('tournament.setup.signup.captainsLabel')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('tournament.setup.signup.captainsHelp')}
                </Typography>
              </Box>
            }
            checked={value.captainCheckIn}
            disabled={disabled}
            onChange={(e) => onChange({ captainCheckIn: e.target.checked })}
            data-testid="signup-captain-checkin"
          />
        )}
      </Box>
    </Box>
  );
}
