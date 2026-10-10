import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { SealCheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { ExternalLink } from '../../common/ExternalLink';
import { tokens, textSize } from '../../../theme/tokens';

const { color } = tokens;

/**
 * The license line at the bottom of the public event page, always shown:
 * licensed for commercial use (a paid key) or non-profit use (a free key),
 * linking to the license's public check page, or "No license key" without a
 * valid key (`GET /api/license/badge`). Nothing while it loads or if it
 * can't be read.
 */
type Badge = { use: 'commercial' | 'non_commercial' | 'none'; verifyUrl: string | null };

export function LicensedBadge() {
  const { t } = useTranslation();
  const [badge, setBadge] = useState<Badge | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<{ badge: Badge | null }>('/api/license/badge')
      .then((res) => {
        if (active) setBadge(res.badge ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!badge) return null;

  const wrap = {
    mt: 6,
    display: 'flex',
    justifyContent: 'center',
    fontSize: textSize.sm,
    color: color.muted,
  };
  if (badge.use === 'none' || !badge.verifyUrl) {
    return (
      <Box sx={wrap} data-testid="tournament-licensed-badge" data-use="none">
        {t('license.public.unlicensed')}
      </Box>
    );
  }

  return (
    <Box sx={wrap} data-testid="tournament-licensed-badge" data-use={badge.use}>
      <ExternalLink
        href={badge.verifyUrl}
        underline="hover"
        sx={{ color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
      >
        <Box component={SealCheckIcon} size="1.1em" aria-hidden />
        {badge.use === 'non_commercial'
          ? t('license.public.nonCommercial')
          : t('license.public.commercial')}
      </ExternalLink>
    </Box>
  );
}
