/**
 * The navbar during the break before a match's veto (2026-10-15 drafts, board 1):
 * "Veto in 3:12", a pill with an orange dot (nothing to do yet), linking to the
 * match room, where the same countdown is the page.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme/tokens';
import { NavPill } from './NavPill';

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
    <NavPill
      to={to}
      testId="nav-veto-countdown"
      dot={tokens.color.accent}
      text={
        vetoOff
          ? left > 0
            ? t('navStatus.matchIn')
            : t('navStatus.matchLoading')
          : left > 0
            ? t('navStatus.vetoIn')
            : t('navStatus.vetoOpening')
      }
      clock={left > 0 ? clock : null}
      live={vetoOff && left <= 0}
    />
  );
}
