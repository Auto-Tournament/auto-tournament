/**
 * The check CS2 runs before a tournament started from the setup page actually
 * starts (3.0 phase E).
 *
 * The setup page's start asks before it starts rather than after: it counts
 * what the fleet can take right now against how many of the first round's
 * matches want to run at the same time, and stops to ask when there are fewer
 * servers than matches. All three ways it phrases that — none free, not
 * enough, could not tell — are about servers, and so is the way out, which is
 * to go and look at the Servers page.
 *
 * Moved out of `pages/Tournament.tsx` whole: the same request, the same
 * `tournament.dialogs.start.*` copy in all ten locales, the same warning
 * colour, and the same navigation to `/servers` on dismiss. A game with no
 * servers can never be short of one, so it fills this slot with nothing and
 * its tournament starts without being asked.
 *
 * The core mounts this for one start and unmounts it when the answer is in,
 * so the check always begins from nothing and a count from the last attempt
 * can never flash up over this one.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Typography } from '@mui/material';
import { Trans } from 'react-i18next';
import { paths } from '../../../paths';
import { ConfirmDialog, api, useModuleTranslation } from '../../../module-sdk';
import type { TournamentStartPreflightProps } from '../../types';

export const Cs2StartPreflight: React.FC<TournamentStartPreflightProps> = ({
  open,
  concurrentMatches,
  onProceed,
  onCancel,
}) => {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('cs2');
  const [warning, setWarning] = useState<{
    requiredServers: number;
    availableServers: number;
  } | null>(null);

  // The check runs once per "start" click. The callbacks are new functions on
  // every render of the page above, so they are read through a ref rather than
  // depended on, which would re-run the request mid-answer.
  const onProceedRef = useRef(onProceed);
  useEffect(() => {
    onProceedRef.current = onProceed;
  });

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const requiredServers = concurrentMatches;

      // Check server availability first
      try {
        const availabilityResponse = await api.get<{
          success: boolean;
          availableServerCount: number;
        }>('/api/tournament/server-availability');

        if (cancelled) return;

        if (availabilityResponse.success) {
          const available = availabilityResponse.availableServerCount;

          // If we don't have enough available servers to cover the first
          // round's concurrent matches, ask so the admin explicitly accepts
          // queued/paused matches.
          if (requiredServers > 0 && available < requiredServers) {
            setWarning({ requiredServers, availableServers: available });
            return;
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Error checking server availability:', err);
        // Continue anyway if check fails
      }

      if (cancelled) return;
      // Servers are sufficient (or the check failed) - start immediately.
      onProceedRef.current();
    };

    void check();

    return () => {
      cancelled = true;
    };
  }, [concurrentMatches]);

  const requiredServers = warning?.requiredServers ?? 0;
  const availableServers = warning?.availableServers ?? 0;
  const hasServerCounts = requiredServers > 0;
  const noServers = hasServerCounts && availableServers === 0;
  const insufficientServers =
    hasServerCounts && availableServers > 0 && availableServers < requiredServers;

  return (
    <ConfirmDialog
      open={open && warning !== null}
      title={
        noServers
          ? t('tournament.dialogs.start.titleNoServers')
          : insufficientServers
          ? t('tournament.dialogs.start.titleInsufficient')
          : t('tournament.dialogs.start.titleUncertain')
      }
      message={
        <>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {noServers && (
              <>
                <Typography variant="body2" fontWeight={600} gutterBottom>
                  {t('tournament.dialogs.start.noServersHeading')}
                </Typography>
                <Typography variant="body2">
                  {t('tournament.dialogs.start.noServersBody')}
                </Typography>
              </>
            )}
            {insufficientServers && (
              <>
                <Typography variant="body2" fontWeight={600} gutterBottom>
                  {t('tournament.dialogs.start.insufficientHeading')}
                </Typography>
                <Typography variant="body2">
                  <Trans
                    t={t}
                    i18nKey="tournament.dialogs.start.insufficientBody"
                    values={{
                      available: t('tournament.counts.availableServers', {
                        count: availableServers,
                      }),
                      required: t('tournament.counts.concurrentMatches', {
                        count: requiredServers,
                      }),
                    }}
                    components={{ b: <strong /> }}
                  />
                </Typography>
              </>
            )}
            {!noServers && !insufficientServers && (
              <>
                <Typography variant="body2" fontWeight={600} gutterBottom>
                  {t('tournament.dialogs.start.uncertainHeading')}
                </Typography>
                <Typography variant="body2">
                  {t('tournament.dialogs.start.uncertainBody')}
                </Typography>
              </>
            )}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {t('tournament.dialogs.start.question')}
          </Typography>
        </>
      }
      confirmLabel={t('tournament.dialogs.start.confirm')}
      cancelLabel={t('tournament.dialogs.start.cancel')}
      onConfirm={onProceed}
      onCancel={() => {
        onCancel();
        navigate(paths.servers);
      }}
      confirmColor="warning"
    />
  );
};
