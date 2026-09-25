import { useEffect, useId, useState } from 'react';
import { Alert, Box, ButtonBase, CircularProgress, Collapse, Container, Typography } from '@mui/material';
import { CaretDownIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { EmptyPanel, FactGrid, PageHead, Panel, Row, RowList, SectionHead } from '../components/common/ui';
import { ExternalLink } from '../components/common/ExternalLink';
import { CompatDot, compatTone, compatToneColor } from '../components/compat/CompatDot';
import { useCompat, useNow } from '../hooks/useCompat';
import { pageTitle } from '../utils/pageTitle';
import { tokens, fontMono, mono, radii, textSize } from '../theme/tokens';
import type { CompatCheck, CompatSnapshot } from '../types/compat.types';

const { color } = tokens;

/** "3 minutes ago", in the page's language. */
function relativeTime(iso: string, now: number, language: string): string {
  const seconds = Math.min(0, Math.round((Date.parse(iso) - now) / 1000));
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

function absoluteTime(iso: string, language: string): string {
  return new Date(iso).toLocaleString(language);
}

function TimeAgo({ iso, now, prefix }: { iso: string; now: number; prefix?: (time: string) => string }) {
  const { i18n } = useTranslation();
  const time = relativeTime(iso, now, i18n.language);
  return (
    <Box component="time" dateTime={iso} title={absoluteTime(iso, i18n.language)}>
      {prefix ? prefix(time) : time}
    </Box>
  );
}

/** The big verdict at the top: overall status, when it was checked, and what was checked. */
function OverallPanel({ latest, now }: { latest: CompatSnapshot; now: number }) {
  const { t } = useTranslation();
  const tone = compatTone(latest.overall);
  return (
    <Panel sx={{ p: { xs: 3, md: 4 }, mb: 5, display: 'grid', gap: 3 }} data-testid="compat-overall">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap' }}>
        <CompatDot tone={tone} size={16} data-testid="compat-overall-dot" />
        <Box sx={{ minWidth: 0, flex: '1 1 16rem' }}>
          <Typography
            variant="h4"
            component="h2"
            data-testid="compat-overall-status"
            data-status={latest.overall}
            sx={{ color: compatToneColor[tone], letterSpacing: '-0.02em' }}
          >
            {t(`compatPage.overall.${latest.overall}`)}
          </Typography>
          <Typography sx={{ color: color.muted, fontSize: textSize.sm, mt: 0.5 }}>
            {t(`compatPage.overallHint.${latest.overall}`)}
          </Typography>
        </Box>
        <Box sx={{ textAlign: { xs: 'left', sm: 'right' }, fontSize: textSize.sm, color: color.muted }}>
          <Box data-testid="compat-checked-ago">
            <TimeAgo iso={latest.checked_at} now={now} prefix={(time) => t('compatPage.checkedAgo', { time })} />
          </Box>
          <ExternalLink href={latest.run.url} data-testid="compat-run-link" sx={{ fontSize: textSize.sm }}>
            {t('compatPage.viewRun')}
          </ExternalLink>
        </Box>
      </Box>
      <FactGrid
        variant="fact"
        aria-label={t('compatPage.factsLabel')}
        sx={{ gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}
        items={[
          {
            key: 'patch',
            label: t('compatPage.facts.patch'),
            value: <Box sx={mono}>{latest.cs2.patch || '—'}</Box>,
            'data-testid': 'compat-patch',
          },
          {
            key: 'buildid',
            label: t('compatPage.facts.buildid'),
            value: <Box sx={mono}>{latest.cs2.buildid}</Box>,
            'data-testid': 'compat-buildid',
          },
          {
            key: 'readyup',
            label: t('compatPage.facts.readyup'),
            value: (
              <Box sx={mono} title={latest.readyup.commit}>
                {latest.readyup.version}{' '}
                <Box component="span" sx={{ color: color.muted }}>
                  ({latest.readyup.commit.slice(0, 7)})
                </Box>
              </Box>
            ),
            'data-testid': 'compat-readyup',
          },
          {
            key: 'stage',
            label: t('compatPage.facts.stage'),
            value: `${t(`compatPage.stage.${latest.run.stage}`)} · ${t(`compatPage.state.${latest.run.state}`)}`,
            'data-testid': 'compat-stage',
          },
        ]}
      />
    </Panel>
  );
}

function CheckRow({ check }: { check: CompatCheck }) {
  const { t } = useTranslation();
  return (
    <Box
      component="li"
      data-testid={`compat-check-${check.kind}`}
      sx={{ py: 1.25, '& + &': { borderTop: `1px solid ${color.rule}` } }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <CompatDot tone={compatTone(check.status)} size={8} />
        <Box sx={{ fontWeight: 500, minWidth: 0 }}>{t(`compatPage.kind.${check.kind}`)}</Box>
        <Box sx={{ ...mono, fontSize: textSize.sm, color: color.ink2 }} data-testid="compat-check-count">
          {check.passed}/{check.total}
        </Box>
        <Box sx={{ fontSize: textSize.sm, color: compatToneColor[compatTone(check.status)], minWidth: '5.5rem', textAlign: 'right' }}>
          {t(`compatPage.status.${check.status}`)}
        </Box>
      </Box>
      {check.failures.length > 0 && (
        <Box
          component="ul"
          aria-label={t('compatPage.failures')}
          sx={{
            listStyle: 'none',
            m: 0,
            mt: 1,
            ml: 3,
            p: 1.5,
            bgcolor: color.paper3,
            borderRadius: radii.md,
            fontFamily: fontMono,
            fontSize: textSize.xs,
            color: color.ink2,
            display: 'grid',
            gap: 0.5,
            overflowWrap: 'anywhere',
          }}
        >
          {check.failures.map((failure, i) => (
            <li key={i}>{failure}</li>
          ))}
        </Box>
      )}
    </Box>
  );
}

function ComponentRow({ component }: { component: CompatSnapshot['components'][number] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const tone = compatTone(component.status);
  const passed = component.checks.reduce((sum, c) => sum + c.passed, 0);
  const total = component.checks.reduce((sum, c) => sum + c.total, 0);

  return (
    <Row sx={{ display: 'block', p: 0 }} data-testid={`compat-component-${component.id}`}>
      <ButtonBase
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`compat-component-toggle-${component.id}`}
        sx={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: { xs: 'auto minmax(0, 1fr) auto auto', sm: 'auto minmax(0, 1fr) auto auto auto' },
          alignItems: 'center',
          gap: 2,
          px: 3,
          py: 2,
          textAlign: 'left',
          borderRadius: radii.lg,
          '&:hover': { bgcolor: color.paper3 },
          '&.Mui-focusVisible': { outline: `2px solid ${color.focus}`, outlineOffset: -2 },
        }}
      >
        <CompatDot tone={tone} data-testid={`compat-component-dot-${component.id}`} />
        <Box sx={{ fontWeight: 600, minWidth: 0 }}>{component.name}</Box>
        <Box
          sx={{ display: { xs: 'none', sm: 'block' }, fontSize: textSize.sm, color: color.muted }}
        >
          {component.checks.length > 0
            ? t('compatPage.checksSummary', { passed, total })
            : t('compatPage.noChecks')}
        </Box>
        <Box
          data-testid={`compat-component-status-${component.id}`}
          data-status={component.status}
          sx={{
            fontSize: textSize.sm,
            fontWeight: 500,
            color: compatToneColor[tone],
            minWidth: { xs: 0, sm: '5.5rem' },
            textAlign: 'right',
          }}
        >
          {t(`compatPage.status.${component.status}`)}
        </Box>
        <Box
          component={CaretDownIcon}
          size={18}
          aria-hidden
          sx={{ color: color.muted, transition: 'transform 150ms', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Box id={panelId} sx={{ px: 3, pb: 2 }}>
          {component.checks.length === 0 ? (
            <Typography sx={{ color: color.muted, fontSize: textSize.sm }}>{t('compatPage.noChecks')}</Typography>
          ) : (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {component.checks.map((check, i) => (
                <CheckRow key={`${check.kind}-${i}`} check={check} />
              ))}
            </Box>
          )}
        </Box>
      </Collapse>
    </Row>
  );
}

/**
 * Ready Up compatibility ("/compatibility"): public, no sign-in. Whether the
 * Ready Up plugin suite works on the newest CS2 build, per component with
 * the checks behind it, and the recent runs. The Ready Up CI reports runs to
 * the API (services/compatService.ts); the page follows them live over
 * Socket.IO (`compat:update`).
 */
export default function Compatibility() {
  const { t } = useTranslation();
  const { state, latest, runs, live } = useCompat();
  const now = useNow();

  useEffect(() => {
    document.title = pageTitle(t('compatPage.title'));
  }, [t]);

  return (
    <Box minHeight="100vh" bgcolor="transparent" data-testid="compat-page">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead
          title={t('compatPage.title')}
          subtitle={t('compatPage.subtitle')}
          sx={{ mb: 4 }}
          actions={
            state === 'ready' ? (
              <Box
                data-testid="compat-live"
                data-live={live ? 'true' : 'false'}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: textSize.sm, color: color.muted }}
              >
                <CompatDot tone={live ? 'pass' : 'none'} size={8} />
                {live ? t('compatPage.live') : t('compatPage.offline')}
              </Box>
            ) : undefined
          }
        />

        {state === 'loading' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress aria-label={t('compatPage.loading')} />
          </Box>
        )}

        {state === 'disabled' && (
          <EmptyPanel
            data-testid="compat-disabled"
            title={t('compatPage.disabledTitle')}
            description={t('compatPage.disabledDescription')}
          />
        )}

        {state === 'error' && (
          <Alert severity="error" data-testid="compat-error">
            {t('compatPage.loadError')}
          </Alert>
        )}

        {state === 'ready' && !latest && (
          <EmptyPanel
            data-testid="compat-empty"
            title={t('compatPage.emptyTitle')}
            description={t('compatPage.emptyDescription')}
          />
        )}

        {state === 'ready' && latest && (
          <>
            <OverallPanel latest={latest} now={now} />

            <Box component="section" aria-labelledby="compat-components-title" sx={{ mb: 5 }}>
              <SectionHead id="compat-components-title" title={t('compatPage.componentsTitle')} />
              <RowList data-testid="compat-components">
                {latest.components.map((component) => (
                  <ComponentRow key={component.id} component={component} />
                ))}
              </RowList>
            </Box>

            <Box component="section" aria-labelledby="compat-history-title">
              <SectionHead id="compat-history-title" title={t('compatPage.historyTitle')} />
              <RowList data-testid="compat-history">
                {runs.map((run) => (
                  <Row
                    key={run.run.id}
                    data-testid="compat-history-run"
                    data-run-id={run.run.id}
                    columns={{ xs: 'auto minmax(0, 1fr) auto', md: 'auto minmax(0, 1.4fr) minmax(0, 1fr) 9rem auto' }}
                    sx={{ py: 1.5, fontSize: textSize.sm }}
                  >
                    <CompatDot tone={compatTone(run.overall)} size={8} />
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ fontWeight: 500 }}>
                        {t('compatPage.historyItem', { patch: run.cs2.patch || '—', buildid: run.cs2.buildid })}
                      </Box>
                      <Box sx={{ color: compatToneColor[compatTone(run.overall)] }}>
                        {t(`compatPage.overall.${run.overall}`)}
                      </Box>
                    </Box>
                    <Box sx={{ display: { xs: 'none', md: 'block' }, color: color.muted, minWidth: 0 }}>
                      {t(`compatPage.trigger.${run.run.trigger}`)} · {t(`compatPage.stage.${run.run.stage}`)}
                    </Box>
                    <Box sx={{ display: { xs: 'none', md: 'block' }, color: color.muted }}>
                      <TimeAgo iso={run.run.started_at} now={now} />
                    </Box>
                    <ExternalLink href={run.run.url} sx={{ whiteSpace: 'nowrap' }}>
                      {t('compatPage.viewRun')}
                    </ExternalLink>
                  </Row>
                ))}
              </RowList>
            </Box>
          </>
        )}
      </Container>
    </Box>
  );
}
