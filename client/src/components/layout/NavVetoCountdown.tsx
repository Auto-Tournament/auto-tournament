/**
 * The navbar during the break before a match's veto (2026-10-15 drafts, board 1):
 * "Veto in 3:12", outlined with an amber dot (nothing to do yet), linking to the
 * match room, where the same countdown is the page.
 */
import React from 'react';
import { Box, Button } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { mono, radii, tokens } from '../../theme/tokens';

export function NavVetoCountdown({
  opensAt,
  to,
  vetoOff = false,
}: {
  opensAt: string;
  to: string;
  /** No veto in this tournament: "Match in 3:12". */
  vetoOff?: boolean;
}) {
  const { t } = useTranslation();
  const target = Date.parse(opensAt);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!Number.isFinite(target)) return null;
  const left = Math.max(0, Math.round((target - now) / 1000));
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <Button
      component={RouterLink}
      to={to}
      size="small"
      variant="outlined"
      color="inherit"
      data-testid="nav-veto-countdown"
      sx={{
        display: { xs: 'none', sm: 'inline-flex' },
        gap: 1,
        px: 1.75,
        borderRadius: radii.pill,
        borderColor: tokens.color.rule,
        whiteSpace: 'nowrap',
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tokens.color.warning }}
      />
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {vetoOff
          ? left > 0
            ? t('navStatus.matchIn')
            : t('navStatus.matchLoading')
          : left > 0
            ? t('navStatus.vetoIn')
            : t('navStatus.vetoOpening')}
      </Box>
      {left > 0 && (
        <Box component="span" sx={{ ...mono, fontWeight: 600 }}>
          {clock}
        </Box>
      )}
    </Button>
  );
}
