/** Account page: who may invite you to a matchmaking party (everyone, friends, nobody). */
import React from 'react';
import { Box, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { fontDisplay, tokens } from '../../theme/tokens';
import { apiErrorMessage } from '../../utils/api';

const { color } = tokens;
type Policy = 'everyone' | 'friends' | 'nobody';

export function PartyInviteSetting() {
  const { t } = useTranslation();
  const { showError, showSnackbar } = useSnackbar();
  const [value, setValue] = React.useState<Policy | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void fetch('/api/social/settings', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ partyInvitesFrom: Policy }>) : null))
      .then((b) => b && setValue(b.partyInvitesFrom))
      .catch(() => undefined);
  }, []);

  const save = async (next: Policy) => {
    const before = value;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch('/api/social/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyInvitesFrom: next }),
      });
      if (!res.ok) throw new Error(apiErrorMessage(new Error(await res.text()), t('social.settings.saveFailed')));
      showSnackbar(t('social.settings.saved'), 'success');
    } catch (error) {
      setValue(before);
      showError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="section" aria-labelledby="account-party-invites" sx={{ mt: 6 }} data-testid="party-invite-setting">
      <Typography id="account-party-invites" component="h2" variant="h6" sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
        {t('social.settings.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '62ch' }}>
        {t('social.settings.description')}
      </Typography>
      {value && (
        <RadioGroup
          value={value}
          onChange={(e) => void save(e.target.value as Policy)}
          aria-labelledby="account-party-invites"
          sx={{ gap: 0.5 }}
        >
          {(['everyone', 'friends', 'nobody'] as Policy[]).map((p) => (
            <FormControlLabel
              key={p}
              value={p}
              disabled={saving}
              control={<Radio />}
              label={
                <Box>
                  <Typography sx={{ fontWeight: 500 }}>{t(`social.settings.${p}`)}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{t(`social.settings.${p}Hint`)}</Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', '& .MuiRadio-root': { pt: 0.5 } }}
            />
          ))}
        </RadioGroup>
      )}
    </Box>
  );
}
