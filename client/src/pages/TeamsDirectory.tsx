import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputBase,
  TextField,
  Typography,
} from '@mui/material';
import { MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { EmptyPanel, PageHead, Panel } from '../components/common/ui';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';
import { teamProfilePath } from '../paths';
import { tokens, fontMono, radii, textSize, withAlpha } from '../theme/tokens';

const { color } = tokens;

interface DirectoryTeam {
  id: string;
  name: string;
  tag: string | null;
  memberCount: number;
  ownerName: string | null;
  createdAt: number;
}

interface MyTeams {
  owned: DirectoryTeam | null;
  memberOf: Array<DirectoryTeam & { role: 'captain' | 'member' }>;
}

/** The team's tag, or the first letters of its name, for the logo tile. */
function initials(team: Pick<DirectoryTeam, 'name' | 'tag'>): string {
  if (team.tag) return team.tag;
  return team.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function TeamTile({
  team,
  size = 52,
}: {
  team: Pick<DirectoryTeam, 'name' | 'tag'>;
  size?: number;
}) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: radii.md,
        bgcolor: color.paper3,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: size > 60 ? textSize.xl : textSize.sm,
        color: color.ink2,
      }}
    >
      {initials(team)}
    </Box>
  );
}

/**
 * Every team on the site (`/browse/teams`), and the viewer's own: the team
 * they own, the teams they play on, and "Create a team" when they own none.
 * Teams are not tied to a game; a team plays whatever the site runs.
 */
export default function TeamsDirectory() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playerSteamId } = useAuth();
  const [teams, setTeams] = useState<DirectoryTeam[] | null>(null);
  const [mine, setMine] = useState<MyTeams | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('teamsDirectory.title'));
  }, [t]);

  const load = useCallback(() => {
    api
      .get<{ success: boolean; teams?: DirectoryTeam[] }>('/api/team-directory')
      .then((res) => setTeams(res.success && Array.isArray(res.teams) ? res.teams : []))
      .catch(() => setError(true));
    if (playerSteamId) {
      api
        .get<{ success: boolean } & MyTeams>('/api/team-directory/mine')
        .then((res) =>
          setMine(res.success ? { owned: res.owned, memberOf: res.memberOf ?? [] } : null)
        )
        .catch(() => setMine(null));
    }
  }, [playerSteamId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (teams ?? []).filter(
      (team) =>
        !q || team.name.toLowerCase().includes(q) || (team.tag ?? '').toLowerCase().includes(q)
    );
  }, [teams, search]);

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="teams-directory-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead
          title={t('teamsDirectory.title')}
          subtitle={teams ? t('teamsDirectory.count', { count: teams.length }) : undefined}
          sx={{ mb: 3 }}
        />

        {playerSteamId && mine && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
              gap: 1.5,
              mb: 4,
            }}
          >
            {mine.owned ? (
              <Panel
                data-testid="teams-directory-owned"
                sx={{
                  p: 2.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  borderColor: color.accent,
                }}
              >
                <TeamTile team={mine.owned} size={72} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.accent }}
                  >
                    {t('teamsDirectory.yourTeam')}
                  </Typography>
                  <Typography noWrap sx={{ fontWeight: 600, fontSize: textSize.xl }}>
                    {mine.owned.name}
                  </Typography>
                  <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                    {t('teamsDirectory.members', { count: mine.owned.memberCount })}
                  </Typography>
                </Box>
                <Button
                  component={RouterLink}
                  to={teamProfilePath(mine.owned.id)}
                  variant="outlined"
                >
                  {t('teamsDirectory.open')}
                </Button>
              </Panel>
            ) : (
              <Panel
                sx={{
                  p: 2.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  borderStyle: 'dashed',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {t('teamsDirectory.noTeamTitle')}
                  </Typography>
                  <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                    {t('teamsDirectory.noTeamBody')}
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  startIcon={<PlusIcon size={18} aria-hidden />}
                  onClick={() => setCreateOpen(true)}
                  data-testid="teams-directory-create"
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {t('teamsDirectory.create')}
                </Button>
              </Panel>
            )}
            <Panel
              sx={{
                p: 2.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                borderStyle: 'dashed',
              }}
            >
              <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                {t('teamsDirectory.alsoOn')}
              </Typography>
              {mine.memberOf.length === 0 ? (
                <Typography sx={{ fontSize: textSize.sm, color: color.ink2 }}>
                  {t('teamsDirectory.alsoOnNone')}
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {mine.memberOf.map((team) => (
                    <Box
                      key={team.id}
                      component={RouterLink}
                      to={teamProfilePath(team.id)}
                      sx={{
                        px: 1.5,
                        py: 0.75,
                        borderRadius: radii.pill,
                        bgcolor: color.paper3,
                        color: color.ink,
                        textDecoration: 'none',
                        fontSize: textSize.sm,
                        '&:hover': { bgcolor: withAlpha(color.ink, 0.08) },
                      }}
                    >
                      {team.name} · {t(`teamsDirectory.role.${team.role}`)}
                    </Box>
                  ))}
                </Box>
              )}
              <Typography sx={{ fontSize: textSize.xs, color: color.muted }}>
                {t('teamsDirectory.ownOne')}
              </Typography>
            </Panel>
          </Box>
        )}

        <Box role="search" sx={{ display: 'flex', gap: 1, mb: 3 }}>
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              minHeight: 44,
              borderRadius: radii.pill,
              border: `1px solid ${color.rule}`,
              color: color.muted,
            }}
          >
            <MagnifyingGlassIcon size={18} aria-hidden />
            <InputBase
              type="search"
              placeholder={t('teamsDirectory.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              inputProps={{ 'aria-label': t('teamsDirectory.searchPlaceholder') }}
              data-testid="teams-directory-search"
              sx={{ flex: 1, minWidth: 0, fontSize: textSize.sm, color: color.ink }}
            />
          </Box>
        </Box>

        {error ? (
          <Alert severity="error">{t('teamsDirectory.loadError')}</Alert>
        ) : !teams ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress aria-label={t('teamsDirectory.loading')} />
          </Box>
        ) : rows.length === 0 ? (
          <EmptyPanel
            title={t(
              teams.length === 0 ? 'teamsDirectory.emptyTitle' : 'teamsDirectory.noMatchTitle'
            )}
            description={t(
              teams.length === 0
                ? 'teamsDirectory.emptyDescription'
                : 'teamsDirectory.noMatchDescription'
            )}
            data-testid="teams-directory-empty"
          />
        ) : (
          <Box
            data-testid="teams-directory-list"
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                sm: 'repeat(2, minmax(0, 1fr))',
                md: 'repeat(3, minmax(0, 1fr))',
              },
              gap: 1.5,
            }}
          >
            {rows.map((team) => (
              <Box
                key={team.id}
                component={RouterLink}
                to={teamProfilePath(team.id)}
                data-testid="teams-directory-row"
                sx={{
                  p: 2,
                  borderRadius: radii.lg,
                  bgcolor: color.paper2,
                  border: `1px solid ${color.rule}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.75,
                  color: color.ink,
                  textDecoration: 'none',
                  '&:hover': { borderColor: color.ink2 },
                  '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                }}
              >
                <TeamTile team={team} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 600 }}>
                    {team.name}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: textSize.xs, color: color.muted }}>
                    {[team.tag, t('teamsDirectory.members', { count: team.memberCount })]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Container>

      <CreateTeamDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          navigate(teamProfilePath(id));
        }}
      />
    </Box>
  );
}

function CreateTeamDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (teamId: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.post<{ success: boolean; team?: { id: string }; error?: string }>(
        '/api/team-directory/mine',
        { name, tag }
      );
      if (res.success && res.team) onCreated(res.team.id);
      else setError(res.error || t('teamsDirectory.createFailed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('teamsDirectory.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" data-testid="create-team-dialog">
      <DialogTitle>{t('teamsDirectory.create')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        <TextField
          label={t('teamsDirectory.nameLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputProps={{ maxLength: 32, 'data-testid': 'create-team-name' }}
          autoFocus
        />
        <TextField
          label={t('teamsDirectory.tagLabel')}
          value={tag}
          onChange={(e) => setTag(e.target.value.toUpperCase())}
          helperText={t('teamsDirectory.tagHelp')}
          inputProps={{ maxLength: 5, 'data-testid': 'create-team-tag' }}
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('teamsDirectory.cancel')}</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={saving || name.trim().length < 2 || tag.trim().length < 2}
          data-testid="create-team-submit"
        >
          {t('teamsDirectory.createSubmit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
