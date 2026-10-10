import { Box } from '@mui/material';
import { WarningIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Panel, SectionHead } from '../common/ui';
import { ExternalLink } from '../common/ExternalLink';
import { paths } from '../../paths';
import { tokens, textSize } from '../../theme/tokens';
import { licenseSummary, useLicenseStatus } from '../../hooks/useLicenseStatus';

const { color } = tokens;

/**
 * Right-column "License" line on the admin home (admins only): what the saved
 * key covers with a link to its public check page, or, with no key, a quiet
 * note that the platform is free for non-commercial use. A problem with the
 * key is one warning line pointing to Settings; nothing is ever blocked.
 * Renders nothing when the status can't be read.
 */
export function LicenseOverviewCard() {
  const { t } = useTranslation();
  const { status } = useLicenseStatus();
  if (!status) return null;

  const { license } = status;
  const problem = status.status === 'warning' || status.status === 'invalid';

  return (
    <Panel
      component="section"
      aria-labelledby="admin-home-license-title"
      data-testid="admin-home-license-card"
      sx={{ p: 3, display: 'grid', gap: 1 }}
    >
      <SectionHead
        level={3}
        id="admin-home-license-title"
        title={t('license.title')}
        link={{ to: paths.license, label: t('license.open') }}
        sx={{ mb: 0 }}
      />
      {license ? (
        <Box sx={{ fontSize: textSize.sm }} data-testid="admin-home-license-summary">
          {licenseSummary(license, t)}
          {status.verifyUrl && (
            <>
              {' · '}
              <ExternalLink href={status.verifyUrl}>{t('license.verify')}</ExternalLink>
            </>
          )}
        </Box>
      ) : (
        status.status === 'none' && (
          <Box
            sx={{ fontSize: textSize.sm, color: color.ink2 }}
            data-testid="admin-home-license-none"
          >
            {t('license.none')}{' '}
            <ExternalLink href={status.pricingUrl}>{t('license.pricing')}</ExternalLink>
          </Box>
        )
      )}
      {problem && (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'flex-start',
            fontSize: textSize.sm,
            color: 'warning.main',
          }}
          data-testid="admin-home-license-warning"
        >
          <Box
            component={WarningIcon}
            size="1.1em"
            aria-hidden
            sx={{ flexShrink: 0, mt: '0.15em' }}
          />
          <span>
            {status.status === 'invalid'
              ? t('license.invalidShort')
              : t('license.warningsShort', { count: status.warnings.length })}
          </span>
        </Box>
      )}
    </Panel>
  );
}
