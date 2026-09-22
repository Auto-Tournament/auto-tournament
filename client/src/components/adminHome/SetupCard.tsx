import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { useTranslation } from 'react-i18next';

export interface SetupItem {
  key: string;
  done: boolean;
  /** Only optional items keep showing once done isn't required to hide the whole card. */
  optional?: boolean;
  /** i18n key for the label; interpolation values, if any. */
  labelKey: string;
  labelValues?: Record<string, unknown>;
}

interface SetupCardProps {
  items: SetupItem[];
}

/**
 * "Finish setting up": shown only while at least one item (required or
 * optional) is unfinished, listing exactly the items that are actually
 * checkable today. Hidden entirely once everything — including the optional
 * ones — is done.
 */
export function SetupCard({ items }: SetupCardProps) {
  const { t } = useTranslation();
  const allDone = items.every((item) => item.done);

  if (allDone) return null;

  return (
    <Card variant="outlined" sx={{ borderColor: 'primary.main' }} data-testid="admin-home-setup-card">
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h5" fontWeight={700} mb={1}>
              {t('dashboard.setup.title')}
            </Typography>
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              {items.map((item) => (
                <Box key={item.key} display="flex" alignItems="center" gap={0.75}>
                  {item.done ? (
                    <CheckCircleIcon color="success" fontSize="small" />
                  ) : (
                    <RadioButtonUncheckedIcon color="disabled" fontSize="small" />
                  )}
                  <Typography variant="body2" color={item.done ? 'text.primary' : 'text.secondary'}>
                    {t(item.labelKey, item.labelValues)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>
          <Button
            component={RouterLink}
            to="/settings"
            variant="outlined"
            size="small"
            data-testid="admin-home-setup-open-settings"
          >
            {t('dashboard.setup.openSettings')}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
