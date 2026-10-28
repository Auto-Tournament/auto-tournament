/**
 * The bottom of every page: the license line (LicensedBadge), a link to
 * support the project (Ko-fi) and one to Auto Tournament on one row, then Valve's trademarks and that Auto
 * Tournament is not affiliated with Valve (the website's footer says the
 * same), small underneath.
 */
import { Box, Container } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { textSize, tokens } from '../../theme/tokens';
import { ExternalLink } from '../common/ExternalLink';
import { LicensedBadge } from '../tournament/page/LicensedBadge';

const { color } = tokens;

export function SiteFooter() {
  const { t } = useTranslation();
  return (
    <Container maxWidth="lg" component="footer" data-testid="site-footer" sx={{ mt: 6, pb: 4 }}>
      <Box
        sx={{
          pt: 3,
          borderTop: `1px solid ${color.rule}`,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          fontSize: textSize.sm,
          color: color.muted,
        }}
      >
        <LicensedBadge />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
          <ExternalLink href="https://ko-fi.com/sivert" underline="hover" sx={{ color: 'inherit' }}>
            {t('siteFooter.support')}
          </ExternalLink>
          <ExternalLink
            href="https://autotournament.gg"
            underline="hover"
            sx={{ color: color.ink2, fontWeight: 600 }}
          >
            Auto Tournament
          </ExternalLink>
        </Box>
      </Box>
      <Box
        component="p"
        sx={{
          m: 0,
          mt: 1.5,
          maxWidth: '70ch',
          color: color.muted,
          fontSize: textSize.xs,
          lineHeight: 1.6,
        }}
      >
        {t('siteFooter.trademarks')}
      </Box>
    </Container>
  );
}
