import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAdminTournament } from '../../contexts/AdminTournamentContext';
import { manageTournamentPath, paths, type ManageTournamentTab } from '../../paths';

/**
 * `/manage/tournaments/:id/*`: one tournament in Manage. The id in the address
 * picks the tournament the admin pages below act on (`new`: the one being
 * created), so a shared link opens the right one whatever was picked before.
 */
export function TournamentScope() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const admin = useAdminTournament();
  const target = id === 'new' ? admin.nextId : Number(id);
  const valid = id === 'new' || (Number.isInteger(target) && (target as number) > 0);

  useEffect(() => {
    if (valid && target != null && admin.selectedId !== target) admin.select(target);
  }, [valid, target, admin]);

  const known =
    id === 'new' ||
    admin.tournaments.some((x) => x.id === target) ||
    (target != null && target === admin.nextId);

  if (!valid || (!admin.loading && !known)) {
    return (
      <Alert severity="warning" data-testid="manage-tournament-not-found">
        {t('managePage.tournamentNotFound')}
      </Alert>
    );
  }
  if (admin.loading || target == null || admin.selectedId !== target) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  return <Outlet />;
}

/**
 * The old one-tournament addresses (`/manage/tournament`, `/manage/bracket`,
 * `/manage/matches`, `/manage/disputes`): the same page of the tournament
 * Manage last had open, or of the one being created, with the query.
 */
export function ScopedTournamentRedirect({ tab }: { tab: ManageTournamentTab }) {
  const admin = useAdminTournament();
  const { search, hash } = useLocation();
  if (admin.loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  const params = new URLSearchParams(search);
  const creating =
    tab === 'setup' &&
    (params.has('name') ||
      params.has('template') ||
      admin.selectedId == null ||
      admin.selectedId === admin.nextId);
  if (creating)
    return <Navigate to={`${manageTournamentPath('new', 'setup')}${search}${hash}`} replace />;
  if (admin.selectedId == null) return <Navigate to={paths.tournaments} replace />;
  return <Navigate to={`${manageTournamentPath(admin.selectedId, tab)}${search}${hash}`} replace />;
}
