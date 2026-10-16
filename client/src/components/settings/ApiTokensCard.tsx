import { useCallback, useEffect, useState } from 'react';
import { fmtDateTime } from '../../utils/time';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { CopyIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { tokens, radii, mono } from '../../theme/tokens';
import { SettingsCardHead, SettingsRow } from './SettingsRow';

const { color } = tokens;

interface ApiToken {
  id: number;
  label: string;
  scope: 'admin' | 'readonly';
  fingerprint: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/**
 * Settings -> API tokens: tokens for scripts, bots and the Auto Tournament MCP
 * server, made, named and revoked here. A token's secret is shown once.
 */
export function ApiTokensCard() {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const [list, setList] = useState<ApiToken[] | null>(null);
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<'admin' | 'readonly'>('readonly');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ label: string; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ tokens: ApiToken[] }>('/api/settings/api-tokens');
      setList(r.tokens);
    } catch (error) {
      showError(apiErrorMessage(error, t('apiTokens.loadFailed')));
      setList([]);
    }
  }, [showError, t]);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const make = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ token: ApiToken; secret: string }>('/api/settings/api-tokens', {
        label: label.trim(),
        scope,
      });
      setMade({ label: r.token.label, secret: r.secret });
      setLabel('');
      void load();
    } catch (error) {
      showError(apiErrorMessage(error, t('apiTokens.makeFailed')));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ApiToken) => {
    try {
      await api.delete(`/api/settings/api-tokens/${token.id}`);
      showSuccess(t('apiTokens.revoked', { label: token.label }));
      setRevoking(null);
      void load();
    } catch (error) {
      showError(apiErrorMessage(error, t('apiTokens.revokeFailed')));
    }
  };

  const when = (unix: number | null) => (unix ? fmtDateTime(unix) : t('apiTokens.never'));

  return (
    <Box data-testid="api-tokens">
      <SettingsCardHead title={t('apiTokens.title')} hint={t('apiTokens.hint')} />

      {(list ?? []).map((token) => (
        <SettingsRow
          key={token.id}
          title={token.label}
          sub={t('apiTokens.line', {
            scope: t(`apiTokens.scope.${token.scope}`),
            fingerprint: token.fingerprint,
            used: when(token.lastUsedAt),
          })}
          data-testid={`api-token-${token.label}`}
          control={
            <IconButton
              aria-label={t('apiTokens.revoke', { label: token.label })}
              onClick={() => setRevoking(token)}
              data-testid={`api-token-revoke-${token.label}`}
            >
              <TrashIcon size={18} />
            </IconButton>
          }
        />
      ))}
      {list && list.length === 0 && (
        <Typography sx={{ color: color.ink2, fontSize: '0.875rem', py: 1.5 }}>
          {t('apiTokens.none')}
        </Typography>
      )}

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
        sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mt: 2 }}
      >
        <TextField
          size="small"
          label={t('apiTokens.name')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          helperText={t('apiTokens.nameHelp')}
          inputProps={{ 'data-testid': 'api-token-name', maxLength: 32 }}
        />
        <Select
          size="small"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'admin' | 'readonly')}
          inputProps={{ 'aria-label': t('apiTokens.scopeLabel'), 'data-testid': 'api-token-scope' }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="readonly">{t('apiTokens.scope.readonly')}</MenuItem>
          <MenuItem value="admin">{t('apiTokens.scope.admin')}</MenuItem>
        </Select>
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !label.trim()}
          data-testid="api-token-make"
          sx={{ borderRadius: radii.pill }}
        >
          {t('apiTokens.make')}
        </Button>
      </Box>

      <Dialog open={made !== null} onClose={() => setMade(null)} data-testid="api-token-made">
        {made && (
          <>
            <DialogTitle>{t('apiTokens.madeTitle', { label: made.label })}</DialogTitle>
            <DialogContent>
              <Typography sx={{ mb: 1.5, fontSize: '0.875rem', color: color.ink2 }}>
                {t('apiTokens.madeHelp')}
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1.25,
                  borderRadius: radii.md,
                  bgcolor: color.paper3,
                }}
              >
                <Box
                  component="code"
                  data-testid="api-token-secret"
                  sx={{ ...mono, fontSize: '0.8125rem', wordBreak: 'break-all', flex: 1 }}
                >
                  {made.secret}
                </Box>
                <IconButton
                  aria-label={t('apiTokens.copy')}
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(made.secret)
                      .then(() => showSuccess(t('apiTokens.copied')))
                      .catch(() => undefined);
                  }}
                >
                  <CopyIcon size={18} />
                </IconButton>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setMade(null)}>{t('apiTokens.done')}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog open={revoking !== null} onClose={() => setRevoking(null)}>
        {revoking && (
          <>
            <DialogTitle>{t('apiTokens.revokeTitle', { label: revoking.label })}</DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
                {t('apiTokens.revokeHelp')}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRevoking(null)}>{t('apiTokens.cancel')}</Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => void revoke(revoking)}
                data-testid="api-token-revoke-confirm"
              >
                {t('apiTokens.revokeConfirm')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
