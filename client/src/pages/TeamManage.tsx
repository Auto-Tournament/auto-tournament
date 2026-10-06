import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { CheckIcon, CopyIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { PageHead, Panel, SectionHead } from '../components/common/ui';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { api, apiErrorMessage } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';
import { paths, teamProfilePath } from '../paths';
import { fontMono, radii, textSize, tokens } from '../theme/tokens';
import { useSetupGames } from '../components/tournament/setup/games';
import { useIntegration } from '../integrations/registry';

const { color } = tokens;

type Role = 'owner' | 'captain' | 'member';

interface ManageView {
  team: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl: string | null;
    inviteCode: string | null;
    game: string | null;
  };
  viewerRole: Role;
  rosterLockedBy: string | null;
  members: Array<{
    uid: string;
    steamId: string;
    name: string;
    avatar: string | null;
    role: Role;
    position: string | null;
    lineup: 'starter' | 'sub';
  }>;
  invites: Array<{ uid: string; steamId: string; name: string; avatar: string | null }>;
  requests: Array<{
    uid: string;
    steamId: string;
    name: string;
    avatar: string | null;
    rating: number | null;
  }>;
}

function teamJoinPath(code: string): string {
  return paths.teamJoin.replace(':code', encodeURIComponent(code));
}

/**
 * Running your team (`/t/team/:teamId/manage`), for its owner and captains:
 * name, tag and logo; the roster and its roles; the invite link and the
 * players asking to join; handing the team over and disbanding it (owner).
 */
export default function TeamManage() {
  const { teamId = '' } = useParams<{ teamId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<ManageView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [game, setGame] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Array<{
    id: string;
    name: string;
    avatar?: string | null;
  }> | null>(null);
  const [searching, setSearching] = useState(false);
  const { games } = useSetupGames();
  const [transferTo, setTransferTo] = useState('');
  const [confirm, setConfirm] = useState<null | 'disband' | 'transfer'>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = `/api/team-directory/${encodeURIComponent(teamId)}`;

  // Bumped after every action, so the view reloads from the server.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean } & ManageView>(`${base}/manage`)
      .then((res) => {
        if (cancelled) return;
        setView(res);
        setName(res.team.name);
        setTag(res.team.tag ?? '');
        setGame(res.team.game ?? '');
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiErrorMessage(err, t('teamManage.loadError')));
      });
    return () => {
      cancelled = true;
    };
  }, [base, t, version]);

  useEffect(() => {
    document.title = pageTitle(
      view ? t('teamManage.pageTitle', { name: view.team.name }) : t('teamManage.title')
    );
  }, [view, t]);

  /** Runs one action, then reloads; errors show above the page. */
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError('');
    setNotice('');
    try {
      await fn();
      if (done) setNotice(done);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(apiErrorMessage(err, t('teamManage.actionFailed')));
    }
  };

  const uploadLogo = async (file: File) => {
    await act(async () => {
      const res = await fetch(`${base}/logo`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error(await res.text());
    }, t('teamManage.logoSaved'));
  };

  /** "Or find a player": by name, Steam ID or Steam profile link. */
  const findPlayers = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await api.get<{
        success: boolean;
        players?: Array<{ id: string; name: string; avatar?: string | null }>;
      }>(`/api/players/find?query=${encodeURIComponent(q)}`);
      setFound(res.success ? (res.players ?? []) : []);
    } catch {
      setFound([]);
    } finally {
      setSearching(false);
    }
  };

  // The game's positions and team size, for the roster's selects and count.
  const integration = useIntegration(game || null);
  const positions = game ? (integration.teamPositions ?? []) : [];

  if (loadError) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Container maxWidth="lg" sx={{ py: 6 }}>
          <Alert severity="error" data-testid="team-manage-error">
            {loadError}
          </Alert>
        </Container>
      </Box>
    );
  }
  if (!view) {
    return (
      <Box minHeight="100vh" bgcolor="transparent">
        <TopNavBar />
        <Box display="flex" justifyContent="center" py={10}>
          <CircularProgress aria-label={t('teamManage.loading')} />
        </Box>
      </Box>
    );
  }

  const isOwner = view.viewerRole === 'owner';
  const inviteLink = view.team.inviteCode
    ? `${window.location.origin}${teamJoinPath(view.team.inviteCode)}`
    : '';
  const others = view.members.filter((m) => m.role !== 'owner' && m.uid);
  const starters = view.members.filter((m) => m.lineup !== 'sub').length;
  const subs = view.members.length - starters;
  const teamSize = game ? integration.teamSize : undefined;
  const memberIds = new Set(view.members.map((m) => m.steamId));
  const invitedIds = new Set(view.invites.map((i) => i.steamId));
  const identityChanged =
    name.trim() !== view.team.name ||
    tag !== (view.team.tag ?? '') ||
    game !== (view.team.game ?? '');

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="team-manage-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <Box
          component={RouterLink}
          to={teamProfilePath(view.team.id)}
          sx={{ fontSize: textSize.sm, color: color.ink2 }}
        >
          ← {t('teamManage.back', { name: view.team.name })}
        </Box>
        <PageHead
          title={t('teamManage.title')}
          sx={{ mt: 1, mb: 3 }}
          actions={
            <Button
              variant="contained"
              data-testid="team-manage-save"
              disabled={!identityChanged}
              onClick={() =>
                act(() => api.patch(base, { name, tag, game: game || null }), t('teamManage.saved'))
              }
            >
              {t('teamManage.save')}
            </Button>
          }
        />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>
            {notice}
          </Alert>
        )}
        {view.rosterLockedBy && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('teamManage.locked', { tournament: view.rosterLockedBy })}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 360px' },
            gap: 3,
            alignItems: 'start',
          }}
        >
          <Box sx={{ display: 'grid', gap: 3, minWidth: 0 }}>
            <Panel
              component="section"
              aria-labelledby="team-manage-identity"
              sx={{
                p: 3,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '140px minmax(0, 1fr)' },
                gap: 3,
              }}
            >
              <Typography id="team-manage-identity" sx={{ position: 'absolute', left: -9999 }}>
                {t('teamManage.identity')}
              </Typography>
              <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 120,
                    height: 120,
                    borderRadius: radii.lg,
                    border: `2px solid ${color.accent}`,
                    bgcolor: color.paper3,
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                    fontWeight: 700,
                    fontSize: textSize['2xl'],
                    color: color.accent,
                  }}
                >
                  {view.team.logoUrl ? (
                    <Box
                      component="img"
                      src={view.team.logoUrl}
                      alt=""
                      sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    (view.team.tag || view.team.name.slice(0, 2)).toUpperCase()
                  )}
                </Box>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  data-testid="team-manage-logo-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadLogo(file);
                    e.target.value = '';
                  }}
                />
                <Button size="small" variant="outlined" onClick={() => fileRef.current?.click()}>
                  {t('teamManage.uploadLogo')}
                </Button>
                {view.team.logoUrl && (
                  <Button size="small" onClick={() => act(() => api.delete(`${base}/logo`))}>
                    {t('teamManage.removeLogo')}
                  </Button>
                )}
                <Typography sx={{ fontSize: textSize.xs, color: color.muted, textAlign: 'center' }}>
                  {t('teamManage.logoHelp')}
                </Typography>
              </Box>
              <Box sx={{ display: 'grid', gap: 2, alignContent: 'start' }}>
                <TextField
                  label={t('teamsDirectory.nameLabel')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  inputProps={{ maxLength: 32, 'data-testid': 'team-manage-name' }}
                />
                <TextField
                  label={t('teamsDirectory.tagLabel')}
                  value={tag}
                  onChange={(e) => setTag(e.target.value.toUpperCase())}
                  helperText={t('teamsDirectory.tagHelp')}
                  inputProps={{ maxLength: 5 }}
                />
                <TextField
                  select
                  label={t('teamManage.game')}
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                  helperText={t('teamManage.gameHelp')}
                  SelectProps={{ displayEmpty: true }}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ 'data-testid': 'team-manage-game' }}
                >
                  <MenuItem value="">{t('teamManage.noGame')}</MenuItem>
                  {games.map((g) => (
                    <MenuItem key={g.id} value={g.id}>
                      {g.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </Panel>

            <Box component="section" aria-labelledby="team-manage-roster">
              <SectionHead
                id="team-manage-roster"
                title={t('teamManage.roster')}
                action={
                  <Typography
                    component="span"
                    data-testid="team-manage-lineup-count"
                    sx={{ fontSize: textSize.sm, color: color.muted }}
                  >
                    {teamSize
                      ? t('teamManage.lineupCount', { starters, size: teamSize, count: subs })
                      : t('teamsDirectory.members', { count: view.members.length })}
                  </Typography>
                }
              />
              <Panel
                component="ul"
                sx={{ listStyle: 'none', m: 0, p: 1.5, display: 'grid', gap: 1 }}
                data-testid="team-manage-roster"
              >
                {view.members.map((m) => (
                  <Box
                    component="li"
                    key={m.steamId}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '40px minmax(0, 1fr) auto',
                        sm: `40px minmax(0, 1fr) ${positions.length ? 'auto ' : ''}auto auto auto`,
                      },
                      gap: 1.5,
                      alignItems: 'center',
                      p: 1,
                      borderRadius: radii.md,
                      bgcolor: color.paper3,
                    }}
                  >
                    <PlayerAvatar
                      id={m.steamId}
                      name={m.name}
                      avatarUrl={m.avatar ?? undefined}
                      size={40}
                    />
                    <Typography noWrap sx={{ fontWeight: 600 }}>
                      {m.name}
                    </Typography>
                    {positions.length > 0 && m.uid && (
                      <Select
                        size="small"
                        displayEmpty
                        value={m.position ?? ''}
                        onChange={(e) =>
                          act(() =>
                            api.patch(`${base}/members/${encodeURIComponent(m.uid)}`, {
                              position: e.target.value || null,
                            })
                          )
                        }
                        inputProps={{ 'aria-label': t('teamManage.positionFor', { name: m.name }) }}
                        data-testid="team-manage-position"
                        sx={{ minWidth: 120, gridColumn: { xs: '2 / -1', sm: 'auto' } }}
                      >
                        <MenuItem value="">{t('teamManage.noPosition')}</MenuItem>
                        {positions.map((p) => (
                          <MenuItem key={p} value={p}>
                            {t(`teamPositions.${p}`, { ns: integration.id, defaultValue: p })}
                          </MenuItem>
                        ))}
                      </Select>
                    )}
                    {m.uid && (
                      <Select
                        size="small"
                        value={m.lineup}
                        onChange={(e) =>
                          act(() =>
                            api.patch(`${base}/members/${encodeURIComponent(m.uid)}`, {
                              lineup: e.target.value,
                            })
                          )
                        }
                        inputProps={{ 'aria-label': t('teamManage.lineupFor', { name: m.name }) }}
                        data-testid="team-manage-lineup"
                        sx={{ minWidth: 110, gridColumn: { xs: '2 / -1', sm: 'auto' } }}
                      >
                        <MenuItem value="starter">{t('teamManage.lineup.starter')}</MenuItem>
                        <MenuItem value="sub">{t('teamManage.lineup.sub')}</MenuItem>
                      </Select>
                    )}
                    {isOwner && m.role !== 'owner' ? (
                      <Select
                        size="small"
                        value={m.role}
                        onChange={(e) =>
                          act(() =>
                            api.patch(`${base}/members/${encodeURIComponent(m.uid)}`, {
                              role: e.target.value,
                            })
                          )
                        }
                        inputProps={{ 'aria-label': t('teamManage.roleFor', { name: m.name }) }}
                        sx={{ minWidth: 130 }}
                      >
                        <MenuItem value="captain">{t('teamManage.role.captain')}</MenuItem>
                        <MenuItem value="member">{t('teamManage.role.member')}</MenuItem>
                      </Select>
                    ) : (
                      <Typography
                        sx={{
                          fontSize: textSize.sm,
                          color: m.role === 'owner' ? color.accent : color.ink2,
                        }}
                      >
                        {t(`teamManage.role.${m.role}`)}
                      </Typography>
                    )}
                    {m.role === 'owner' || (!isOwner && m.role === 'captain') ? (
                      <Box sx={{ width: 40 }} />
                    ) : (
                      <IconButton
                        aria-label={t('teamManage.remove', { name: m.name })}
                        disabled={Boolean(view.rosterLockedBy)}
                        onClick={() =>
                          act(() => api.delete(`${base}/members/${encodeURIComponent(m.uid)}`))
                        }
                        sx={{ color: color.ban }}
                      >
                        <XIcon size={16} />
                      </IconButton>
                    )}
                  </Box>
                ))}
              </Panel>
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gap: 3 }}>
            <Panel
              component="section"
              sx={{ p: 2.5, display: 'grid', gap: 1.5 }}
              aria-labelledby="team-manage-invite"
            >
              <Typography
                id="team-manage-invite"
                component="h2"
                sx={{ fontWeight: 600, fontSize: textSize.lg }}
              >
                {t('teamManage.invite')}
              </Typography>
              <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                {t('teamManage.inviteHelp')}
              </Typography>
              {inviteLink ? (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Box
                    data-testid="team-manage-invite-link"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      px: 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: radii.md,
                      bgcolor: color.paper3,
                      fontFamily: fontMono,
                      fontSize: textSize.xs,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {inviteLink}
                  </Box>
                  <IconButton
                    aria-label={t('teamManage.copy')}
                    onClick={() => {
                      void navigator.clipboard?.writeText(inviteLink);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
                  </IconButton>
                </Box>
              ) : null}
              <Box>
                <Button
                  size="small"
                  variant="outlined"
                  data-testid="team-manage-invite-reset"
                  onClick={() => act(() => api.post(`${base}/invite`))}
                >
                  {inviteLink ? t('teamManage.inviteReset') : t('teamManage.inviteCreate')}
                </Button>
              </Box>
              <Typography sx={{ fontSize: textSize.sm, color: color.muted, mt: 1 }}>
                {t('teamManage.findPlayer')}
              </Typography>
              <Box
                component="form"
                sx={{ display: 'flex', gap: 1 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void findPlayers();
                }}
              >
                <TextField
                  size="small"
                  fullWidth
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('teamManage.findPlaceholder')}
                  inputProps={{
                    'aria-label': t('teamManage.findPlayer'),
                    'data-testid': 'team-manage-find',
                  }}
                />
                <Button type="submit" variant="outlined" disabled={searching || !query.trim()}>
                  {t('teamManage.find')}
                </Button>
              </Box>
              {found && found.length === 0 && (
                <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                  {t('teamManage.findNone')}
                </Typography>
              )}
              {found?.map((p) => (
                <Box
                  key={p.id}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  data-testid="team-manage-found"
                >
                  <PlayerAvatar
                    id={p.id}
                    name={p.name}
                    avatarUrl={p.avatar ?? undefined}
                    size={32}
                  />
                  <Typography noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
                    {p.name}
                  </Typography>
                  {memberIds.has(p.id) ? (
                    <Typography sx={{ fontSize: textSize.xs, color: color.muted }}>
                      {t('teamManage.onTeam')}
                    </Typography>
                  ) : invitedIds.has(p.id) ? (
                    <Typography sx={{ fontSize: textSize.xs, color: color.muted }}>
                      {t('teamManage.invited')}
                    </Typography>
                  ) : (
                    <Button
                      size="small"
                      variant="contained"
                      data-testid="team-manage-invite-player"
                      onClick={() =>
                        act(
                          () => api.post(`${base}/invites`, { steamId: p.id }),
                          t('teamManage.inviteSent', { name: p.name })
                        )
                      }
                    >
                      {t('teamManage.invitePlayer')}
                    </Button>
                  )}
                </Box>
              ))}
              {view.invites.length > 0 && (
                <Box sx={{ display: 'grid', gap: 0.75, mt: 1 }} data-testid="team-manage-pending">
                  <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                    {t('teamsDirectory.invitesPending', { count: view.invites.length })}
                  </Typography>
                  {view.invites.map((i) => (
                    <Box key={i.uid} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PlayerAvatar
                        id={i.steamId}
                        name={i.name}
                        avatarUrl={i.avatar ?? undefined}
                        size={28}
                      />
                      <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: textSize.sm }}>
                        {i.name}
                      </Typography>
                      <IconButton
                        size="small"
                        aria-label={t('teamManage.cancelInvite', { name: i.name })}
                        onClick={() =>
                          act(() => api.delete(`${base}/invites/${encodeURIComponent(i.uid)}`))
                        }
                      >
                        <XIcon size={14} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}
            </Panel>

            <Panel
              component="section"
              sx={{ p: 2.5, display: 'grid', gap: 1.5 }}
              aria-labelledby="team-manage-requests"
            >
              <Typography
                id="team-manage-requests"
                component="h2"
                sx={{ fontWeight: 600, fontSize: textSize.lg }}
              >
                {t('teamManage.requests')}
              </Typography>
              {view.requests.length === 0 ? (
                <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                  {t('teamManage.requestsNone')}
                </Typography>
              ) : (
                view.requests.map((r) => (
                  <Box
                    key={r.uid}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                    data-testid="team-manage-request"
                  >
                    <PlayerAvatar
                      id={r.steamId}
                      name={r.name}
                      avatarUrl={r.avatar ?? undefined}
                      size={36}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontWeight: 600 }}>
                        {r.name}
                      </Typography>
                      {r.rating !== null && (
                        <Typography sx={{ fontSize: textSize.xs, color: color.muted }}>
                          {t('teamManage.rating', { rating: Math.round(r.rating) })}
                        </Typography>
                      )}
                    </Box>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      disabled={Boolean(view.rosterLockedBy)}
                      onClick={() =>
                        act(() => api.post(`${base}/requests/${encodeURIComponent(r.uid)}/accept`))
                      }
                    >
                      {t('teamManage.accept')}
                    </Button>
                    <IconButton
                      aria-label={t('teamManage.decline', { name: r.name })}
                      onClick={() =>
                        act(() => api.post(`${base}/requests/${encodeURIComponent(r.uid)}/decline`))
                      }
                    >
                      <XIcon size={16} />
                    </IconButton>
                  </Box>
                ))
              )}
            </Panel>

            {isOwner && (
              <Panel
                component="section"
                sx={{ p: 2.5, display: 'grid', gap: 1.5, borderColor: color.ban }}
              >
                <Typography component="h2" sx={{ fontWeight: 600, color: color.ban }}>
                  {t('teamManage.owner')}
                </Typography>
                <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                  {t('teamManage.ownerHelp')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Select
                    size="small"
                    displayEmpty
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                    inputProps={{ 'aria-label': t('teamManage.transferTo') }}
                    sx={{ minWidth: 160 }}
                  >
                    <MenuItem value="" disabled>
                      {t('teamManage.transferTo')}
                    </MenuItem>
                    {others.map((m) => (
                      <MenuItem key={m.uid} value={m.uid}>
                        {m.name}
                      </MenuItem>
                    ))}
                  </Select>
                  <Button
                    variant="outlined"
                    disabled={!transferTo}
                    onClick={() => setConfirm('transfer')}
                  >
                    {t('teamManage.transfer')}
                  </Button>
                </Box>
                <Box>
                  <Button
                    color="error"
                    variant="outlined"
                    onClick={() => setConfirm('disband')}
                    data-testid="team-manage-disband"
                  >
                    {t('teamManage.disband')}
                  </Button>
                </Box>
                <Typography sx={{ fontSize: textSize.xs, color: color.muted }}>
                  {t('teamManage.disbandHelp')}
                </Typography>
              </Panel>
            )}
          </Box>
        </Box>
      </Container>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'disband' ? t('teamManage.disbandTitle') : t('teamManage.transferTitle')}
        message={
          confirm === 'disband'
            ? t('teamManage.disbandConfirm', { name: view.team.name })
            : t('teamManage.transferConfirm', {
                name: others.find((m) => m.uid === transferTo)?.name ?? '',
              })
        }
        confirmLabel={confirm === 'disband' ? t('teamManage.disband') : t('teamManage.transfer')}
        confirmColor={confirm === 'disband' ? 'error' : 'primary'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const which = confirm;
          setConfirm(null);
          if (which === 'disband') {
            try {
              await api.delete(base);
              navigate(paths.browseTeams);
            } catch (err) {
              setError(apiErrorMessage(err, t('teamManage.actionFailed')));
            }
          } else if (which === 'transfer') {
            try {
              await api.post(`${base}/transfer`, { uid: transferTo });
              navigate(teamProfilePath(view.team.id));
            } catch (err) {
              setError(apiErrorMessage(err, t('teamManage.actionFailed')));
            }
          }
        }}
      />
    </Box>
  );
}
