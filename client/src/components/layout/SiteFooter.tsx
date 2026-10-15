/**
 * The line at the bottom of every page: Valve's trademarks and that Auto
 * Tournament is not affiliated with Valve (the website's footer says the same).
 */
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { textSize, tokens } from '../../theme/tokens';

export function SiteFooter() {
  const { t } = useTranslation();
  return (
    <Box
      component="footer"
      data-testid="site-footer"
      sx={{
        px: 2,
        py: 3,
        textAlign: 'center',
        color: tokens.color.muted,
        fontSize: textSize.xs,
        lineHeight: 1.6,
      }}
    >
      {t('siteFooter.trademarks')}
    </Box>
  );
}
