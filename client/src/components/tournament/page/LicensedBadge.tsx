import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { SealCheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { ExternalLink } from '../../common/ExternalLink';
import { tokens, textSize } from '../../../theme/tokens';

const { color } = tokens;

/**
 * The optional "Licensed" line on the public event page, linking to the
 * license's public check page. Shown only when an admin turned it on and the
 * saved key is a genuine platform license (`GET /api/license/badge`); in
 * every other case, including no license at all, it renders nothing.
 */
export function LicensedBadge() {
  const { t } = useTranslation();
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<{ badge: { verifyUrl: string } | null }>('/api/license/badge')
      .then((res) => {
        if (active) setVerifyUrl(res.badge?.verifyUrl ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!verifyUrl) return null;

  return (
    <Box
      sx={{ mt: 6, display: 'flex', justifyContent: 'center', fontSize: textSize.sm, color: color.muted }}
      data-testid="tournament-licensed-badge"
    >
      <ExternalLink
        href={verifyUrl}
        underline="hover"
        sx={{ color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
      >
        <Box component={SealCheckIcon} size="1.1em" aria-hidden />
        {t('license.public.licensed')}
      </ExternalLink>
    </Box>
  );
}
