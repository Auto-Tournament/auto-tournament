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
  MenuItem,
  Select,
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
import { useSetupGames } from '../components/tournament/setup/games';
import { useInstalledIntegrations } from '../integrations/registry';
import { tokens, fontMono, radii, textSize, withAlpha } from '../theme/tokens';

const { color } = tokens;

interface DirectoryTeam {
  id: string;
  name: string;
  tag: string | null;
  memberCount: number;
  ownerName: string | null;
  logoUrl?: string | null;
  createdAt: number;
  game?: string | null;
  rating?: number | null;
  record?: { wins: number; losses: number };
  bestMap?: string | null;
  pendingInvites?: number;
}

interface ReceivedInvite {
  teamId: string;
  name: string;
  tag: string | null;
  invitedBy: string | null;
}

interface MyTeams {
  owned: DirectoryTeam | null;
  memberOf: Array<DirectoryTeam & { role: 'captain' | 'member' }>;
  invites: ReceivedInvite[];
}

type SortKey = 'rating' | 'name' | 'newest';

/** "de_mirage" reads as "Mirage". */
function prettyMap(map: string): string {
  const name = map.replace(/^[a-z]+_/, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
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
 * A team plays whatever the site runs; its game is the one it mainly plays,
 * for the filter and "Looking for N".
 */
export default function TeamsDirectory() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playerSteamId } = useAuth();
  const [teams, setTeams] = useState<DirectoryTeam[] | null>(null);
  const [mine, setMine] = useState<MyTeams | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [gameFilter, setGameFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('rating');
  const [createOpen, setCreateOpen] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const { games } = useSetupGames();
  const integrations = useInstalledIntegrations();
  const gameName = (id: string) => games.find((g) => g.id === id)?.name ?? id;
  const teamSizeFor = (game: string | null | undefined) =>
    game
      ? integrations.find(
          (i) => i.id === game || i.catalogSlug === game || i.catalogGames?.includes(game)
        )?.teamSize
      : undefined;

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
          setMine(
            res.success
              ? { owned: res.owned, memberOf: res.memberOf ?? [], invites: res.invites ?? [] }
              : null
          )
        )
        .catch(() => setMine(null));
    }
  }, [playerSteamId]);

  useEffect(() => {
    load();
  }, [load]);

  const answerInvite = async (teamId: string, accept: boolean) => {
    setAnswering(teamId);
    try {
      await api.post(`/api/team-directory/${encodeURIComponent(teamId)}/invites/answer`, {
        accept,
      });
      if (accept) navigate(teamProfilePath(teamId));
      else load();
    } catch {
      load();
    } finally {
      setAnswering(null);
    }
  };

  // The games the listed teams play, for the filter.
  const teamGames = useMemo(
    () => [...new Set((teams ?? []).map((team) => team.game).filter((g): g is string => !!g))],
    [teams]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (teams ?? []).filter(
      (team) =>
        (gameFilter === 'all' || team.game === gameFilter) &&
        (!q || team.name.toLowerCase().includes(q) || (team.tag ?? '').toLowerCase().includes(q))
    );
    return list.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'newest'
          ? b.createdAt - a.createdAt
          : (b.rating ?? -1) - (a.rating ?? -1) || a.name.localeCompare(b.name)
    );
  }, [teams, search, gameFilter, sort]);

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="teams-directory-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead
          title={t('teamsDirectory.title')}
          subtitle={teams ? t('teamsDirectory.count', { count: teams.length }) : undefined}
          sx={{ mb: 3 }}
        />

        {playerSteamId && mine && mine.invites.length > 0 && (
          <Box
            component="section"
            aria-label={t('teamsDirectory.invites.title')}
            data-testid="teams-directory-invites"
            sx={{ display: 'grid', gap: 1, mb: 2 }}
          >
            {mine.invites.map((invite) => (
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
                <TeamTile team={invite} size={44} />
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
                  onClick={() => void answerInvite(invite.teamId, true)}
                  data-testid="teams-directory-invite-accept"
                >
                  {t('teamsDirectory.invites.accept')}
                </Button>
                <Button
                  disabled={answering === invite.teamId}
                  onClick={() => void answerInvite(invite.teamId, false)}
                >
                  {t('teamsDirectory.invites.decline')}
                </Button>
              </Panel>
            ))}
          </Box>
        )}

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
                    {[
                      t('teamsDirectory.members', { count: mine.owned.memberCount }),
                      mine.owned.pendingInvites
                        ? t('teamsDirectory.invitesPending', { count: mine.owned.pendingInvites })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
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
          {teamGames.length > 0 && (
            <Select
              size="small"
              value={gameFilter}
              onChange={(e) => setGameFilter(e.target.value)}
              inputProps={{ 'aria-label': t('teamsDirectory.gameFilter') }}
              data-testid="teams-directory-game"
              sx={{ borderRadius: radii.pill, minWidth: 140 }}
            >
              <MenuItem value="all">{t('teamsDirectory.allGames')}</MenuItem>
              {teamGames.map((g) => (
                <MenuItem key={g} value={g}>
                  {gameName(g)}
                </MenuItem>
              ))}
            </Select>
          )}
          <Select
            size="small"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            inputProps={{ 'aria-label': t('teamsDirectory.sortLabel') }}
            data-testid="teams-directory-sort"
            sx={{ borderRadius: radii.pill, minWidth: 140 }}
          >
            {(['rating', 'name', 'newest'] as const).map((key) => (
              <MenuItem key={key} value={key}>
                {t(`teamsDirectory.sort.${key}`)}
              </MenuItem>
            ))}
          </Select>
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
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontWeight: 600 }}>
                    {team.name}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: textSize.xs, color: color.muted }}>
                    {[
                      team.tag,
                      team.game ? gameName(team.game) : null,
                      t('teamsDirectory.members', { count: team.memberCount }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                  <Typography
                    noWrap
                    data-testid="teams-directory-row-numbers"
                    sx={{
                      fontFamily: fontMono,
                      fontSize: textSize.xs,
                      color: color.ink2,
                      mt: 0.25,
                    }}
                  >
                    {[
                      typeof team.rating === 'number' ? String(team.rating) : null,
                      team.record && team.record.wins + team.record.losses > 0
                        ? `${team.record.wins}–${team.record.losses}`
                        : null,
                      team.bestMap
                        ? t('teamsDirectory.bestMap', { map: prettyMap(team.bestMap) })
                        : !team.record || team.record.wins + team.record.losses === 0
                          ? t('teamsDirectory.new')
                          : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
                {(() => {
                  const size = teamSizeFor(team.game);
                  const open = size ? size - team.memberCount : 0;
                  return open > 0 ? (
                    <Box
                      data-testid="teams-directory-looking"
                      sx={{
                        flex: 'none',
                        px: 1,
                        py: 0.25,
                        borderRadius: radii.pill,
                        bgcolor: withAlpha(color.accent, 0.14),
                        color: color.accent,
                        fontSize: textSize.xs,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('teamsDirectory.lookingFor', { count: open })}
                    </Box>
                  ) : null;
                })()}
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
