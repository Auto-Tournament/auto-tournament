/**
 * Disputes (`/disputes`) — results nobody agrees on (3.0 phase D, PR D8).
 *
 * A sibling of the admin home rather than a corner of Manage: Manage is about
 * the tournament running *right now* (what is live, what is waiting for a
 * server), and a dispute is a match that is already over and stuck. It also
 * outlives the tournament being in progress, which the Manage console does
 * not.
 *
 * The page owns the URL, the heading and the empty state; the queue inside it
 * belongs to the module that owns the tournament, because only that module
 * knows what a disputed result is. CS2 fills the slot with nothing — a CS2
 * result comes from the game server and there is nobody to disagree with it —
 * so this page says so instead of showing an empty list that can never fill.
 */

import { useEffect } from 'react';
import { Box, Card, CardContent, LinearProgress, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useTournamentStatus } from '../hooks/useTournamentStatus';
import { useIntegrationFor } from '../integrations/registry';

export default function Disputes() {
  const { t } = useTranslation();
  const { tournament, loading } = useTournamentStatus();

  useEffect(() => {
    document.title = t('disputes.title');
  }, [t]);

  const DisputesView = useIntegrationFor(tournament).adminDisputesView;

  return (
    <Box data-testid="disputes-page" sx={{ width: '100%' }}>
      <Stack spacing={3} sx={{ width: '100%', maxWidth: 1100 }}>
        <Box>
          {/* The shell header above already shows the page title; only the description stays. */}
          <Typography variant="body2" color="text.secondary">
            {t('disputes.subheading')}
          </Typography>
        </Box>

        {loading ? (
          <LinearProgress />
        ) : DisputesView ? (
          <DisputesView tournamentId={tournament?.id ?? null} />
        ) : (
          <Card data-testid="disputes-not-applicable">
            <CardContent sx={{ py: 5, textAlign: 'center' }}>
              <Typography variant="h6" gutterBottom>
                {t('disputes.notApplicable.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('disputes.notApplicable.hint')}
              </Typography>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  );
}
