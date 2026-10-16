/**
 * Who may report and confirm a manually reported match (the drafts' manual
 * report board): the team's captains, and for its owner Make captain /
 * Remove captain beside each member. Read from the team's own manage view;
 * nothing for a viewer who may not see it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { radii, tokens } from '../../theme/tokens';
import { PlayerAvatar, h2Sx, panel } from '../tournament/ui/draftUi';

type Role = 'owner' | 'captain' | 'member';

interface ManageView {
  viewerRole: Role;
  members: Array<{ uid: string; steamId: string; name: string; avatar: string | null; role: Role }>;
}

export function CaptainsPanel({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [view, setView] = useState<ManageView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/team-directory/${encodeURIComponent(teamId)}`;

  const load = useCallback(() => {
    api
      .get<{ success: boolean } & ManageView>(`${base}/manage`)
      .then((res) => setView(res))
      .catch(() => setView(null));
  }, [base]);
  useEffect(() => {
    load();
  }, [load]);

  if (!view) return null;
  const isOwner = view.viewerRole === 'owner';
  const setRole = async (uid: string, role: 'captain' | 'member') => {
    setBusy(uid);
    try {
      await api.patch(`${base}/members/${encodeURIComponent(uid)}`, { role });
      load();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box
      component="section"
      aria-labelledby="captains-title"
      data-testid="match-captains"
      sx={panel}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 1,
        }}
      >
        <Typography id="captains-title" component="h2" sx={h2Sx}>
          {t('captainsPanel.title')}
        </Typography>
        <Typography component="span" sx={{ fontSize: '0.875rem', color: tokens.color.ink2 }}>
          {t('captainsPanel.note')}
        </Typography>
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {view.members.map((m) => (
          <Box
            component="li"
            key={m.uid || m.steamId}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
              py: 1,
              borderTop: `1px solid ${tokens.color.rule}`,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
              <PlayerAvatar id={m.steamId} name={m.name} avatar={m.avatar} size={32} />
              <Typography component="span" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {m.name}
              </Typography>
              {m.role !== 'member' && (
                <Box
                  component="span"
                  sx={{
                    px: 1.25,
                    py: 0.25,
                    borderRadius: radii.pill,
                    bgcolor: tokens.color.paper3,
                    color: m.role === 'owner' ? tokens.color.accent : tokens.color.ink2,
                    fontSize: '0.75rem',
                    fontWeight: 700,
                  }}
                >
                  {t(`captainsPanel.role.${m.role}`)}
                </Box>
              )}
            </Box>
            {isOwner && m.role !== 'owner' && m.uid && (
              <Button
                size="small"
                variant="outlined"
                disabled={busy === m.uid}
                onClick={() => void setRole(m.uid, m.role === 'captain' ? 'member' : 'captain')}
              >
                {m.role === 'captain' ? t('captainsPanel.remove') : t('captainsPanel.make')}
              </Button>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
