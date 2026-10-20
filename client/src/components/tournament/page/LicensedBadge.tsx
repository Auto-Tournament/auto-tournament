import { useEffect, useState } from 'react';
import { Box, Link, Typography } from '@mui/material';
import { InfoIcon, SealCheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { ExternalLink } from '../../common/ExternalLink';
import { radii, tokens, textSize } from '../../../theme/tokens';
import { DraftDialog } from '../ui/draftUi';

const { color } = tokens;

/**
 * The license line at the bottom of every page (SiteFooter), always shown:
 * licensed for commercial use (a paid key) or non-profit use (a free key),
 * or "No license key" without a valid key (`GET /api/license/badge`). It
 * opens a short explainer: what that means, and what to do if you were asked
 * to pay entry for an event that has no license for it (report it). Nothing while it loads or if it
 * can't be read.
 */
type Badge = { use: 'commercial' | 'non_commercial' | 'none'; verifyUrl: string | null };

export function LicensedBadge() {
  const { t } = useTranslation();
  const [badge, setBadge] = useState<Badge | null>(null);
  const [open, setOpen] = useState(false);

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

  const wrap = { display: 'flex', fontSize: textSize.sm, color: color.muted };
  const licensed = badge.use !== 'none' && !!badge.verifyUrl;
  return (
    <Box sx={wrap} data-testid="tournament-licensed-badge" data-use={licensed ? badge.use : 'none'}>
      <Link
        component="button"
        type="button"
        onClick={() => setOpen(true)}
        underline="hover"
        data-testid="tournament-license-info"
        sx={{
          color: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          fontSize: 'inherit',
        }}
      >
        <Box component={licensed ? SealCheckIcon : InfoIcon} size="1.1em" aria-hidden />
        {!licensed
          ? t('license.public.unlicensed')
          : badge.use === 'non_commercial'
            ? t('license.public.nonCommercial')
            : t('license.public.commercial')}
      </Link>
      <DraftDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('license.public.about.title')}
        titleId="license-info-title"
        testId="license-info-dialog"
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, color: color.ink2 }}>
          <Typography>
            {!licensed
              ? t('license.public.about.none')
              : badge.use === 'non_commercial'
                ? t('license.public.about.nonCommercial')
                : t('license.public.about.commercial')}
          </Typography>
          <Typography>{t('license.public.about.free')}</Typography>
          <Box
            sx={{
              p: 2,
              borderRadius: radii.md,
              bgcolor: color.paper3,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
            }}
          >
            <Typography sx={{ fontWeight: 700, color: color.ink }}>
              {t('license.public.about.paidTitle')}
            </Typography>
            <Typography>
              {licensed && badge.use === 'commercial'
                ? t('license.public.about.paidCommercial')
                : t('license.public.about.paidBody')}
            </Typography>
            <ExternalLink href="https://autotournament.gg/contact" sx={{ alignSelf: 'flex-start' }}>
              {t('license.public.about.report')}
            </ExternalLink>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <ExternalLink href="https://autotournament.gg/license">
              {t('license.public.about.rules')}
            </ExternalLink>
            {licensed && badge.verifyUrl && (
              <ExternalLink href={badge.verifyUrl}>{t('license.public.about.verify')}</ExternalLink>
            )}
          </Box>
        </Box>
      </DraftDialog>
    </Box>
  );
}
