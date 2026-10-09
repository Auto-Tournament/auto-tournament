/**
 * Admin: import a match played somewhere else from its demos (`/played/import`).
 *
 * Creates the match, uploads each demo in pieces (a proxy like Cloudflare
 * refuses one request over 100 MB), then follows the demo worker: the teams,
 * players and each map's score appear as the demos are read
 * (api: integrations/cs2/demos/demoImport.ts).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  LinearProgress,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowDownIcon, ArrowUpIcon, FileArrowUpIcon, XIcon } from '@phosphor-icons/react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHead, Panel, Row, RowList } from '../components/common/ui';
import { api, apiErrorMessage } from '../utils/api';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';

const MAX_MAPS = 5;
/** Under Cloudflare's 100 MB request limit with room to spare. */
const CHUNK = 32 * 1024 * 1024;

interface ImportMap {
  mapNumber: number;
  map: string | null;
  uploaded: boolean;
  analysis: string | null;
  error: string | null;
  team1Score: number | null;
  team2Score: number | null;
}

interface ImportStatus {
  slug: string;
  team1: string;
  team2: string;
  maps: ImportMap[];
}

export default function ImportMatch() {
  const { t } = useTranslation();
  const [event, setEvent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ n: number; percent: number } | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = pageTitle(t('importMatch.title'));
  }, [t]);

  // Follow the demo worker until every map is read.
  const allDone =
    !!status && status.maps.every((m) => m.analysis === 'done' || m.analysis === 'failed');
  useEffect(() => {
    if (!status || allDone || busy) return;
    const id = setInterval(() => {
      api
        .get<{ import: ImportStatus }>(`/api/game/cs2/imports/${encodeURIComponent(status.slug)}`)
        .then((res) => setStatus(res.import))
        .catch(() => null);
    }, 5000);
    return () => clearInterval(id);
  }, [status, allDone, busy]);

  const add = (list: ArrayLike<File> | null) => {
    if (!list) return;
    const picked = Array.from(list);
    const bad = picked.find((f) => !f.name.toLowerCase().endsWith('.dem'));
    if (bad) {
      setError(t('importMatch.notDemo', { name: bad.name }));
      return;
    }
    const next = [...files, ...picked].slice(0, MAX_MAPS);
    if (files.length + picked.length > MAX_MAPS)
      setError(t('importMatch.tooMany', { max: MAX_MAPS }));
    else setError(null);
    setFiles(next);
  };

  const move = (i: number, by: number) => {
    const next = [...files];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    setFiles(next);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ slug: string }>('/api/game/cs2/imports', {
        maps: files.length,
        event: event.trim() || undefined,
      });
      const slug = encodeURIComponent(created.slug);
      for (const [i, file] of files.entries()) {
        for (let offset = 0; offset < file.size; offset += CHUNK) {
          setUpload({ n: i + 1, percent: Math.floor((offset / file.size) * 100) });
          await api.fetch(
            `/api/game/cs2/imports/${slug}/maps/${i}?offset=${offset}&total=${file.size}`,
            {
              method: 'PUT',
              body: file.slice(offset, Math.min(offset + CHUNK, file.size)),
              headers: { 'Content-Type': 'application/octet-stream' },
            }
          );
        }
      }
      setUpload(null);
      const res = await api.get<{ import: ImportStatus }>(`/api/game/cs2/imports/${slug}`);
      setStatus(res.import);
    } catch (err) {
      setError(t('importMatch.error', { error: apiErrorMessage(err, '') }));
    } finally {
      setBusy(false);
      setUpload(null);
    }
  };

  const reset = () => {
    setStatus(null);
    setFiles([]);
    setEvent('');
    setError(null);
  };

  const stateOf = (m: ImportMap) =>
    !m.uploaded
      ? t('importMatch.state.uploading')
      : m.analysis === 'done'
        ? t('importMatch.state.done')
        : m.analysis === 'failed'
          ? t('importMatch.state.failed')
          : m.analysis === 'running'
            ? t('importMatch.state.running')
            : t('importMatch.state.waiting');

  return (
    <Box data-testid="import-match-page" sx={{ width: '100%', maxWidth: 760 }}>
      <PageHead title={t('importMatch.title')} subtitle={t('importMatch.subtitle')} />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="import-error">
          {error}
        </Alert>
      )}

      {!status ? (
        <Panel sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <TextField
            label={t('importMatch.event')}
            helperText={t('importMatch.eventHelp')}
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            disabled={busy}
            size="small"
            inputProps={{ maxLength: 100, 'data-testid': 'import-event' }}
          />
          <Box>
            <Typography variant="subtitle2">{t('importMatch.files')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('importMatch.filesHelp')}
            </Typography>
            {files.length > 0 && (
              <RowList sx={{ mb: 1.5 }}>
                {files.map((f, i) => (
                  <Row key={`${f.name}-${i}`} sx={{ gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0 }}>
                      {t('importMatch.mapN', { n: i + 1 })}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
                    >
                      {f.name} · {(f.size / 1024 ** 2).toFixed(0)} MB
                    </Typography>
                    <IconButton
                      size="small"
                      disabled={busy || i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={t('importMatch.moveUp', { name: f.name })}
                    >
                      <ArrowUpIcon size={16} />
                    </IconButton>
                    <IconButton
                      size="small"
                      disabled={busy || i === files.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={t('importMatch.moveDown', { name: f.name })}
                    >
                      <ArrowDownIcon size={16} />
                    </IconButton>
                    <IconButton
                      size="small"
                      disabled={busy}
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      aria-label={t('importMatch.remove', { name: f.name })}
                    >
                      <XIcon size={16} />
                    </IconButton>
                  </Row>
                ))}
              </RowList>
            )}
            <input
              ref={input}
              type="file"
              accept=".dem"
              multiple
              hidden
              data-testid="import-files"
              onChange={(e) => {
                add(e.target.files);
                e.target.value = '';
              }}
            />
            <Button
              variant="outlined"
              startIcon={<FileArrowUpIcon />}
              onClick={() => input.current?.click()}
              disabled={busy || files.length >= MAX_MAPS}
            >
              {t('importMatch.choose')}
            </Button>
          </Box>
          {upload && (
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {t('importMatch.uploading', upload)}
              </Typography>
              <LinearProgress variant="determinate" value={upload.percent} />
            </Box>
          )}
          <Box>
            <Button
              variant="contained"
              disabled={busy || files.length === 0}
              onClick={() => void start()}
              data-testid="import-start"
            >
              {t('importMatch.start')}
            </Button>
          </Box>
        </Panel>
      ) : (
        <Panel
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          data-testid="import-status"
        >
          <Typography variant="h6" component="h2">
            {t('importMatch.teams', { team1: status.team1, team2: status.team2 })}
          </Typography>
          <RowList>
            {status.maps.map((m) => (
              <Row key={m.mapNumber} sx={{ gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: '4.5rem' }}>
                  {t('importMatch.mapN', { n: m.mapNumber + 1 })}
                </Typography>
                <Typography variant="body2" sx={{ minWidth: '7rem' }}>
                  {m.map ?? '—'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                  {stateOf(m)}
                </Typography>
                {m.team1Score !== null && (
                  <Typography
                    variant="body2"
                    sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                  >
                    {m.team1Score}–{m.team2Score}
                  </Typography>
                )}
              </Row>
            ))}
          </RowList>
          {!allDone && <LinearProgress />}
          {allDone && <Alert severity="success">{t('importMatch.doneAll')}</Alert>}
          <Stack direction="row" spacing={2} alignItems="center">
            <Link
              component={RouterLink}
              to={paths.match.replace(':slug', status.slug)}
              data-testid="import-open"
            >
              {t('importMatch.openMatch')}
            </Link>
            {allDone && (
              <Button size="small" onClick={reset}>
                {t('importMatch.another')}
              </Button>
            )}
          </Stack>
        </Panel>
      )}
    </Box>
  );
}
