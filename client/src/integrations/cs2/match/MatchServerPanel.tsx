import { Box, Button, Typography, Alert } from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import { FadeInImage } from '../../../components/common/FadeInImage';
import { tokens, mono, withAlpha } from '../../../theme/tokens';
import type { MatchConnectPanelProps as MatchServerPanelProps } from '../../types';

export function MatchServerPanel({
  server,
  currentMapData,
  currentMapNumber,
  connected,
  copied,
  onConnect,
  onCopy,
}: MatchServerPanelProps) {
  const { t } = useTranslation();

  if (!server) {
    return (
      <Alert severity="info">
        <Typography variant="body2" fontWeight={600} gutterBottom>
          {t('matchInfo.server.waitingTitle')}
        </Typography>
        <Typography variant="body2">{t('matchInfo.server.waitingBody')}</Typography>
      </Alert>
    );
  }

  // The API sends an English label alongside the raw MatchZy status; translate
  // the known statuses and fall back to that label for anything new.
  const statusLabel = server.status
    ? t(`matchInfo.server.statusLabels.${server.status}`, {
        defaultValue: server.statusDescription?.label || server.status,
      })
    : '';

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {currentMapData && (
        <FadeInImage
          src={currentMapData.image}
          alt={currentMapData.displayName}
          height={180}
          sx={{
            borderRadius: 2,
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: `linear-gradient(to bottom, ${withAlpha(tokens.color.paper, 0.3)}, ${withAlpha(tokens.color.paper, 0.7)})`,
            }}
          >
            <Typography
              variant="h3"
              sx={{
                fontWeight: 700,
                color: 'text.primary',
                textShadow: `0 2px 12px ${tokens.color.shadow}`,
              }}
            >
              {currentMapData.displayName}
            </Typography>
            {typeof currentMapNumber === 'number' && (
              <Typography
                variant="caption"
                sx={{
                  mt: 0.5,
                  color: 'text.secondary',
                  fontSize: '0.7rem',
                  ...mono,
                  textShadow: `0 1px 6px ${tokens.color.shadow}`,
                }}
              >
                {t('matchInfo.mapN', { n: currentMapNumber + 1 })}
              </Typography>
            )}
          </Box>
        </FadeInImage>
      )}

      <Box display="flex" flexDirection="column" gap={2}>
        {/* Server info */}
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('matchInfo.server.serverName', { name: server.name })}
          </Typography>
          <Typography variant="body2" color="text.secondary" fontFamily="monospace">
            {server.host}:{server.port}
          </Typography>
          {server.status && (
            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
              {t('matchInfo.server.status', { status: statusLabel })}
            </Typography>
          )}
        </Box>

        <Button
          variant="contained"
          size="large"
          fullWidth
          color={connected ? 'success' : 'primary'}
          startIcon={<SportsEsportsIcon />}
          onClick={onConnect}
          disabled={!server.host || !server.port} // Disable if server details missing
          sx={{ py: 1.5 }}
        >
          {connected ? t('matchInfo.server.connecting') : t('matchInfo.server.connect')}
        </Button>

        <Button
          variant="outlined"
          size="small"
          fullWidth
          startIcon={copied ? null : <ContentCopyIcon />}
          onClick={onCopy}
          disabled={!server.host || !server.port} // Disable if server details missing
        >
          {copied ? t('matchInfo.server.copied') : t('matchInfo.server.copyCommand')}
        </Button>
      </Box>
    </Box>
  );
}
