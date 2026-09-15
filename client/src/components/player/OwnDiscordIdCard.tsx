import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { isInvalidDiscordIdInput, normalizeDiscordId } from '../../utils/discordId';

interface OwnDiscordIdResponse {
  steamId: string;
  discordId: string | null;
}

interface OwnDiscordIdCardProps {
  /** The signed-in player's Steam ID; the card hides itself if the API disagrees. */
  steamId: string;
}

/**
 * Lets a signed-in player view and edit their own Discord ID. Only render this on
 * the viewer's own profile, and never while an admin is impersonating: the
 * endpoint answers for the session, not for the page being viewed.
 */
export const OwnDiscordIdCard: React.FC<OwnDiscordIdCardProps> = ({ steamId }) => {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [savedValue, setSavedValue] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setAvailable(false);
    (async () => {
      try {
        // Plain fetch: 401/403/404 just mean "not for this viewer", so hide quietly.
        const response = await fetch('/api/players/me/discord-id', {
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const data = (await response.json()) as OwnDiscordIdResponse;
        if (cancelled || data.steamId !== steamId) return;
        setSavedValue(data.discordId ?? null);
        setValue(data.discordId ?? '');
        setAvailable(true);
      } catch {
        // Network or parse failure: leave the card hidden.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [steamId]);

  if (!loaded || !available) return null;

  const invalid = isInvalidDiscordIdInput(value);
  const next = normalizeDiscordId(value) ?? null;
  const unchanged = next === savedValue;

  const handleSave = async () => {
    if (invalid || unchanged) return;
    setSaving(true);
    try {
      const response = await api.put<OwnDiscordIdResponse>('/api/players/me/discord-id', {
        discordId: next,
      });
      const stored = response.discordId ?? null;
      setSavedValue(stored);
      setValue(stored ?? '');
      showSuccess(stored ? t('playerPage.discordId.saved') : t('playerPage.discordId.removed'));
    } catch (err) {
      showError(apiErrorMessage(err, t('playerPage.discordId.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="profile-discord-id-section">
      <CardContent>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          {t('playerPage.discordId.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('playerPage.discordId.description')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
          {t('playerPage.discordId.howToFind')}
        </Typography>
        <Box
          component="form"
          display="flex"
          gap={1}
          mt={2}
          alignItems="flex-start"
          flexWrap="wrap"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <TextField
            label={t('discordId.label')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('discordId.placeholder')}
            size="small"
            disabled={saving}
            error={invalid}
            helperText={invalid ? t('discordId.helperInvalid') : t('discordId.helper')}
            sx={{ flex: 1, minWidth: 220, maxWidth: 320 }}
            slotProps={{
              htmlInput: { inputMode: 'numeric', 'data-testid': 'profile-discord-id-input' },
            }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={saving || invalid || unchanged}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
            data-testid="profile-discord-id-save"
            sx={{ mt: 0.25 }}
          >
            {saving ? t('playerPage.discordId.saving') : t('playerPage.discordId.save')}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};
