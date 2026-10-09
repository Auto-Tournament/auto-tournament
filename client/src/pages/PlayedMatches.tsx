/**
 * All matches (`/played`, Vikunja 1834): every match that was played on this
 * site, from any tournament (deleted ones too), standalone matches and
 * matchmaking, newest first. Each has its demo downloads; the ones in view
 * (after the filters) download together as one .tar.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  InputBase,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { DownloadSimpleIcon, FileArrowUpIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { PageHead, Panel, Row, RowList } from '../components/common/ui';
import { pageTitle } from '../utils/pageTitle';
import { api } from '../utils/api';
import { matchDetailsPath, paths } from '../paths';
import { Link as RouterLink } from 'react-router-dom';
import { fontMono, radii, textSize, tokens } from '../theme/tokens';

const { color } = tokens;

interface PlayedMatch {
  slug: string;
  game: string | null;
  kind: 'tournament' | 'standalone' | 'matchmaking' | 'imported';
  tournamentId: number | null;
  tournamentName: string | null;
  completedAt: number | null;
  team1: string;
  team2: string;
  winner: 'team1' | 'team2' | null;
  maps: Array<{ mapNumber: number; map: string | null; team1: number; team2: number }>;
  demos: Array<{ mapNumber: number; map: string | null }>;
}

type KindFilter = 'all' | PlayedMatch['kind'];

function demoUrl(slug: string, mapNumber: number): string {
  return `/api/demos/${encodeURIComponent(slug)}/download${mapNumber > 0 ? `/${mapNumber}` : ''}`;
}

export default function PlayedMatches() {
  const { t, i18n } = useTranslation();
  const [matches, setMatches] = useState<PlayedMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [withDemos, setWithDemos] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('playedMatches.title'));
    api
      .get<{ matches: PlayedMatch[] }>('/api/matches/played')
      .then((body) => setMatches(body.matches))
      .catch((err: Error) => setError(err.message));
  }, [t]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (matches ?? []).filter((m) => {
      if (kind !== 'all' && m.kind !== kind) return false;
      if (withDemos && m.demos.length === 0) return false;
      if (!q) return true;
      return [m.team1, m.team2, m.tournamentName ?? '', m.slug].some((v) =>
        v.toLowerCase().includes(q)
      );
    });
  }, [matches, search, kind, withDemos]);

  const withDemo = shown.filter((m) => m.demos.length > 0);
  const archiveUrl = `/api/demos/archive.tar?slugs=${encodeURIComponent(withDemo.map((m) => m.slug).join(','))}`;
  const when = (s: number | null) =>
    s
      ? new Date(s * 1000).toLocaleString(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';

  return (
    <Box data-testid="played-matches-page" sx={{ width: '100%' }}>
      <Box sx={{ width: '100%', maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <PageHead
          title={t('playedMatches.title')}
          subtitle={t('playedMatches.subtitle')}
          sx={{ mb: 0 }}
          actions={
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                component={RouterLink}
                to={paths.importMatch}
                variant="outlined"
                startIcon={<FileArrowUpIcon />}
                data-testid="played-import"
              >
                {t('playedMatches.import')}
              </Button>
              {withDemo.length > 0 && (
                <Button
                  component="a"
                  href={archiveUrl}
                  variant="contained"
                  startIcon={<DownloadSimpleIcon />}
                  data-testid="played-download-all"
                >
                  {t('playedMatches.downloadAll', { count: withDemo.length })}
                </Button>
              )}
            </Box>
          }
        />

        <Box role="search" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box
            component="label"
            sx={{
              flex: '1 1 16rem',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.75,
              py: 0.5,
              border: `1px solid ${color.rule}`,
              borderRadius: radii.pill,
              color: color.muted,
            }}
          >
            <MagnifyingGlassIcon size={18} aria-hidden />
            <InputBase
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('playedMatches.search')}
              inputProps={{
                'aria-label': t('playedMatches.search'),
                'data-testid': 'played-search',
              }}
              sx={{ flex: 1, minWidth: 0, fontSize: textSize.sm, color: color.ink }}
            />
          </Box>
          <Select
            size="small"
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
            inputProps={{
              'aria-label': t('playedMatches.kindLabel'),
              'data-testid': 'played-kind',
            }}
            sx={{ borderRadius: radii.pill, fontSize: textSize.sm }}
          >
            {(['all', 'tournament', 'standalone', 'matchmaking', 'imported'] as const).map((k) => (
              <MenuItem key={k} value={k}>
                {t(`playedMatches.kind.${k}`)}
              </MenuItem>
            ))}
          </Select>
          <Chip
            label={t('playedMatches.withDemos')}
            onClick={() => setWithDemos((v) => !v)}
            color={withDemos ? 'primary' : 'default'}
            variant={withDemos ? 'filled' : 'outlined'}
            data-testid="played-with-demos"
          />
        </Box>

        {error ? (
          <Panel sx={{ p: 3 }}>
            <Typography color="error">{error}</Typography>
          </Panel>
        ) : matches === null ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : shown.length === 0 ? (
          <Panel sx={{ p: 3 }} data-testid="played-empty">
            <Typography color="text.secondary">
              {matches.length === 0 ? t('playedMatches.none') : t('playedMatches.noneFiltered')}
            </Typography>
          </Panel>
        ) : (
          <RowList data-testid="played-list" aria-label={t('playedMatches.title')}>
            {shown.map((m) => {
              const score =
                m.maps.length === 1
                  ? `${m.maps[0].team1} – ${m.maps[0].team2}`
                  : m.maps.length > 1
                    ? m.maps.map((x) => `${x.team1}–${x.team2}`).join(' · ')
                    : '';
              return (
                <Row
                  key={m.slug}
                  data-testid={`played-${m.slug}`}
                  columns={{
                    xs: 'minmax(0, 1fr)',
                    md: 'minmax(0, 1.4fr) minmax(0, 1fr) 11rem auto',
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Box
                      component={RouterLink}
                      to={matchDetailsPath(m.slug)}
                      sx={{
                        fontWeight: 600,
                        color: color.ink,
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' },
                        overflowWrap: 'anywhere',
                      }}
                    >
                      <Box
                        component="span"
                        sx={{ color: m.winner === 'team1' ? color.ink : color.ink2 }}
                      >
                        {m.team1}
                      </Box>{' '}
                      <Box component="span" sx={{ color: color.muted, fontWeight: 400 }}>
                        {t('playedMatches.vs')}
                      </Box>{' '}
                      <Box
                        component="span"
                        sx={{ color: m.winner === 'team2' ? color.ink : color.ink2 }}
                      >
                        {m.team2}
                      </Box>
                    </Box>
                    <Typography sx={{ fontSize: textSize.xs, color: color.muted }}>
                      {m.kind === 'tournament'
                        ? (m.tournamentName ?? t('playedMatches.kind.tournament')) +
                          (m.tournamentId === null ? ` · ${t('playedMatches.deleted')}` : '')
                        : m.kind === 'imported' && m.tournamentName
                          ? `${t('playedMatches.kind.imported')} · ${m.tournamentName}`
                          : t(`playedMatches.kind.${m.kind}`)}
                    </Typography>
                  </Box>
                  <Box sx={{ fontFamily: fontMono, fontSize: textSize.sm, color: color.ink2 }}>
                    {score}
                    {m.maps.length > 0 && (
                      <Box
                        component="span"
                        sx={{
                          display: 'block',
                          fontFamily: 'inherit',
                          fontSize: textSize.xs,
                          color: color.muted,
                        }}
                      >
                        {m.maps.map((x) => x.map ?? `#${x.mapNumber}`).join(', ')}
                      </Box>
                    )}
                  </Box>
                  <Typography sx={{ fontSize: textSize.sm, color: color.ink2 }}>
                    {when(m.completedAt)}
                  </Typography>
                  <Box
                    sx={{
                      display: 'flex',
                      gap: 0.75,
                      flexWrap: 'wrap',
                      justifySelf: { md: 'end' },
                    }}
                  >
                    {m.demos.length === 0 ? (
                      <Typography sx={{ fontSize: textSize.xs, color: color.muted }}>
                        {t('playedMatches.noDemo')}
                      </Typography>
                    ) : (
                      m.demos.map((d) => (
                        <Button
                          key={d.mapNumber}
                          size="small"
                          variant="outlined"
                          component="a"
                          href={demoUrl(m.slug, d.mapNumber)}
                          startIcon={<DownloadSimpleIcon size={16} />}
                          data-testid={`played-demo-${m.slug}-${d.mapNumber}`}
                        >
                          {m.demos.length > 1
                            ? (d.map ?? t('playedMatches.map', { n: d.mapNumber }))
                            : t('playedMatches.demo')}
                        </Button>
                      ))
                    )}
                  </Box>
                </Row>
              );
            })}
          </RowList>
        )}
      </Box>
    </Box>
  );
}
