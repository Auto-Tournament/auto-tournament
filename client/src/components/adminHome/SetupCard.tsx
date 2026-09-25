import { Link as RouterLink } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { tokens, radii, textSize } from '../../theme/tokens';

const { color } = tokens;

export interface SetupItem {
  key: string;
  done: boolean;
  /** Only optional items keep showing once done isn't required to hide the whole card. */
  optional?: boolean;
  /** i18n key for the label; interpolation values, if any. */
  labelKey: string;
  labelValues?: Record<string, unknown>;
  /** The namespace `labelKey` is in, for a module's row; core's otherwise. */
  ns?: string;
}

interface SetupCardProps {
  items: SetupItem[];
}

/**
 * "Finish setting up" (the draft's `.setup-card`): a notice with an accent
 * border, a small bold label and one line of ✓ / ○ items, shown only while at
 * least one item (required or optional) is unfinished. Hidden entirely once
 * everything, the optional ones included, is done.
 */
export function SetupCard({ items }: SetupCardProps) {
  const { t } = useTranslation();
  const allDone = items.every((item) => item.done);

  if (allDone) return null;

  return (
    <Box
      component="section"
      aria-labelledby="admin-home-setup-title"
      data-testid="admin-home-setup-card"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
        gap: 3,
        alignItems: 'center',
        px: { xs: 3, md: 4 },
        py: 3,
        border: `1px solid ${color.accent}`,
        borderRadius: radii.lg,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box component="b" id="admin-home-setup-title" sx={{ display: 'block', fontWeight: 600 }}>
          {t('dashboard.setup.title')}
        </Box>
        <Box
          component="ul"
          sx={{
            listStyle: 'none',
            m: 0,
            mt: 1,
            p: 0,
            display: 'flex',
            flexWrap: 'wrap',
            columnGap: 3,
            rowGap: 0.5,
            fontSize: textSize.sm,
          }}
        >
          {items.map((item) => (
            <Box
              component="li"
              key={item.key}
              data-done={item.done ? 'true' : 'false'}
              sx={{ color: item.done ? color.live : color.ink2 }}
            >
              <Box component="span" sx={{ mr: 0.75 }}>
                {item.done ? '✓' : '○'}
              </Box>
              {t(item.labelKey, { ...item.labelValues, ns: item.ns })}
            </Box>
          ))}
        </Box>
      </Box>
      <Button
        component={RouterLink}
        to="/settings"
        variant="outlined"
        size="small"
        sx={{ justifySelf: 'start' }}
        data-testid="admin-home-setup-open-settings"
      >
        {t('dashboard.setup.openSettings')}
      </Button>
    </Box>
  );
}
