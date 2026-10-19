import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import { useIntegrationFor } from '../integrations/registry';
import { PageHead } from '../components/common/ui';
import { pageTitle } from '../utils/pageTitle';
import { tokens } from '../theme/tokens';
import type { Untrusted } from '../utils/untrusted';

interface PrizeTournament {
  id: number;
  name: string;
  status: string;
  game?: string | null;
  settings?: Untrusted;
}

/**
 * Manage › one tournament › Prizes (the 3.0 draft's Prizes board): what its
 * placings and MVP win. The game module draws the settings
 * (`tournamentPrizesManage`); this page loads the tournament and saves the
 * module's settings patch.
 */
export default function TournamentPrizes() {
  const { t } = useTranslation();
  const [tournament, setTournament] = useState<PrizeTournament | null>(null);
  const [failed, setFailed] = useState(false);
  const Manage = useIntegrationFor(tournament ?? { game: null }).tournamentPrizesManage;

  useEffect(() => {
    let live = true;
    api
      .get<{ tournament: PrizeTournament }>('/api/tournament')
      .then((res) => live && setTournament(res.tournament))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    document.title = pageTitle(t('prizesPage.title'));
  }, [t]);

  if (failed) return <Alert severity="error">{t('prizesPage.loadFailed')}</Alert>;
  if (!tournament) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      data-testid="tournament-prizes-page"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <PageHead title={t('prizesPage.title')} subtitle={t('prizesPage.intro')} />
      {Manage ? (
        <Manage
          key={tournament.id}
          tournament={tournament}
          onSave={async (patch) => {
            const res = await api.put<{ tournament: PrizeTournament }>('/api/tournament', {
              settings: patch,
            });
            setTournament(res.tournament);
          }}
        />
      ) : (
        <Typography sx={{ color: tokens.color.ink2 }}>{t('prizesPage.none')}</Typography>
      )}
    </Box>
  );
}
