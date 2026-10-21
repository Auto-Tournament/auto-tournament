import { useEffect, useState } from 'react';
import { MenuItem, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../../utils/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';

interface MineTeam {
  id: string;
  name: string;
  tag: string | null;
}

/**
 * The player's own profile: which of their teams shows under their name
 * (PUT /api/players/me/shown-team). Only when they are on more than one.
 */
export function ShownTeamPicker({
  current,
  onChosen,
}: {
  current: string | null;
  onChosen: (team: MineTeam) => void;
}) {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [teams, setTeams] = useState<MineTeam[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get<{ owned?: MineTeam[]; memberOf?: MineTeam[] }>('/api/team-directory/mine')
      .then((r) => live && setTeams([...(r.owned ?? []), ...(r.memberOf ?? [])]))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (teams.length < 2) return null;
  const choose = async (id: string) => {
    const team = teams.find((x) => x.id === id);
    if (!team) return;
    setBusy(true);
    try {
      await api.put('/api/players/me/shown-team', { teamId: id });
      onChosen(team);
    } catch (error) {
      showError(apiErrorMessage(error, t('playerPage.shownTeam.failed')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <TextField
      select
      size="small"
      id="shown-team"
      label={t('playerPage.shownTeam.label')}
      value={current && teams.some((x) => x.id === current) ? current : ''}
      disabled={busy}
      onChange={(e) => void choose(e.target.value)}
      inputProps={{ 'data-testid': 'shown-team-picker' }}
      sx={{ mt: 2, minWidth: 240, maxWidth: '100%' }}
    >
      {teams.map((team) => (
        <MenuItem key={team.id} value={team.id}>
          {team.tag ? `[${team.tag}] ${team.name}` : team.name}
        </MenuItem>
      ))}
    </TextField>
  );
}
