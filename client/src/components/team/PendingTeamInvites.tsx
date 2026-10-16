/**
 * The teams that asked the signed-in player on, with Accept / Decline: on the
 * Teams page, Home and the player's own profile, so an invite is never only
 * in the bell. Nothing shows without one.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Panel } from '../common/ui';
import { TeamLogo } from '../tournament/ui/draftUi';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { api } from '../../utils/api';
import { teamProfilePath } from '../../paths';
import { tokens, textSize } from '../../theme/tokens';
import { answerTeamInvite, useSocial } from '../social/socialStore';

const { color } = tokens;

export interface ReceivedTeamInvite {
  teamId: string;
  name: string;
  tag: string | null;
  logoUrl?: string | null;
  invitedBy: string | null;
}

/**
 * `invites`: the caller has them already (the Teams page); without, the list
 * is asked for, again whenever a team invite notice comes in.
 */
export function PendingTeamInvites({
  invites: given,
  onAnswered,
}: {
  invites?: ReceivedTeamInvite[];
  onAnswered?: (teamId: string, accepted: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showError } = useSnackbar();
  const { playerSteamId } = useAuth();
  const [fetched, setFetched] = useState<ReceivedTeamInvite[]>([]);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const { notices } = useSocial(!given && !!playerSteamId);
  const inviteNotices = notices.filter((n) => n.kind === 'team_invite').length;

  const load = useCallback(() => {
    if (given || !playerSteamId) return;
    api
      .get<{ success: boolean; invites?: ReceivedTeamInvite[] }>('/api/team-directory/mine')
      .then((res) => setFetched(res.success && Array.isArray(res.invites) ? res.invites : []))
      .catch(() => setFetched([]));
  }, [given, playerSteamId]);

  useEffect(() => {
    load();
  }, [load, inviteNotices]);

  const answer = async (teamId: string, accept: boolean) => {
    setAnswering(teamId);
    try {
      await answerTeamInvite(teamId, accept);
      setAnswered((prev) => new Set(prev).add(teamId));
      onAnswered?.(teamId, accept);
      if (accept) navigate(teamProfilePath(teamId));
    } catch (error) {
      showError((error as Error).message);
      load();
    } finally {
      setAnswering(null);
    }
  };

  const invites = (given ?? fetched).filter((i) => !answered.has(i.teamId));
  if (!playerSteamId || invites.length === 0) return null;
  return (
    <Box
      component="section"
      aria-label={t('teamsDirectory.invites.title')}
      data-testid="teams-directory-invites"
      sx={{ display: 'grid', gap: 1 }}
    >
      {invites.map((invite) => (
        <Panel
          key={invite.teamId}
          data-testid="teams-directory-invite"
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
            borderColor: color.accent,
          }}
        >
          <TeamLogo
            team={{
              id: invite.teamId,
              name: invite.name,
              tag: invite.tag,
              logoUrl: invite.logoUrl,
            }}
            size={44}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600 }}>
              {t('teamsDirectory.invites.line', { team: invite.name })}
            </Typography>
            {invite.invitedBy && (
              <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                {t('teamsDirectory.invites.by', { name: invite.invitedBy })}
              </Typography>
            )}
          </Box>
          <Button
            variant="contained"
            disabled={answering === invite.teamId}
            onClick={() => void answer(invite.teamId, true)}
            data-testid="teams-directory-invite-accept"
          >
            {t('teamsDirectory.invites.accept')}
          </Button>
          <Button
            disabled={answering === invite.teamId}
            onClick={() => void answer(invite.teamId, false)}
          >
            {t('teamsDirectory.invites.decline')}
          </Button>
        </Panel>
      ))}
    </Box>
  );
}
