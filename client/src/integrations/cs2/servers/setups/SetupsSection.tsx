import { useState } from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import { PlusIcon } from '@phosphor-icons/react';
import {
  fmtTime,
  fontDisplay,
  mono,
  radii,
  tokens,
  useModuleTranslation,
} from '../../../../module-sdk';
import { SetupEditor } from './SetupEditor';
import type { ServerSetup, Setups } from './useSetups';

const { color } = tokens;

/**
 * Servers › Setups: practice and fun servers an admin starts on any free server and stops when
 * done; the server goes back to tournaments after (api/src/integrations/cs2/serverSetupRuns.ts).
 */
export function SetupsSection({
  data,
  freeCount,
  serverName,
  onOpenServer,
}: {
  data: Setups;
  /** Free servers now (the page's summary): none, no Start. */
  freeCount: number;
  /** A server's name on this page, by its id. */
  serverName: (serverId: string) => string;
  onOpenServer: (serverId: string) => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { setups, running, busy, act, stop, reload } = data;
  const [editing, setEditing] = useState<ServerSetup | 'new' | null>(null);

  const summary = (s: ServerSetup) =>
    `${s.maps.length === 1 ? s.maps[0] : t('setups.mapCount', { count: s.maps.length })} · ${s.plugins.plugins
      .filter((p) => p !== 'fleet' && p !== 'addons')
      .join(', ')}`;

  return (
    <Box
      component="section"
      aria-labelledby="setups-h"
      data-testid="setups-section"
      sx={{
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        borderRadius: radii.lg,
        p: 2.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          <Typography
            id="setups-h"
            component="h2"
            sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.125rem' }}
          >
            {t('setups.title')}
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: '0.8125rem', color: color.ink2 }}>
            {t('setups.about')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<PlusIcon size={14} />}
          onClick={() => setEditing('new')}
          data-testid="setups-new"
          sx={{ borderRadius: radii.pill }}
        >
          {t('setups.new')}
        </Button>
      </Box>

      {setups && setups.length === 0 && (
        <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>{t('setups.none')}</Typography>
      )}
      {setups && setups.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
            gap: 1.5,
          }}
        >
          {setups.map((s) => {
            const run = running.find((r) => r.setupId === s.id);
            return (
              <Box
                key={s.id}
                component="article"
                data-testid={`setup-${s.id}`}
                sx={{
                  border: `1px solid ${run ? color.live : color.rule}`,
                  borderRadius: radii.md,
                  bgcolor: color.paper,
                  p: 1.75,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  minWidth: 0,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ButtonBase
                    onClick={() => setEditing(s)}
                    aria-label={t('setups.edit', { name: s.name })}
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.9375rem',
                      textAlign: 'left',
                      borderRadius: radii.sm,
                      '&:hover': { color: color.accent2 },
                      '&.Mui-focusVisible': { outline: `2px solid ${color.focus}` },
                    }}
                  >
                    {s.name}
                  </ButtonBase>
                  {run && (
                    <Box
                      component="span"
                      sx={{
                        ml: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        fontSize: '0.75rem',
                        color: color.live,
                      }}
                    >
                      <Box
                        component="span"
                        aria-hidden
                        sx={{ width: 7, height: 7, borderRadius: radii.pill, bgcolor: color.live }}
                      />
                      {t('setups.running')}
                    </Box>
                  )}
                </Box>
                <Typography
                  sx={{ ...mono, fontSize: '0.75rem', color: color.ink2, overflowWrap: 'anywhere' }}
                >
                  {summary(s)}
                </Typography>
                {run && (
                  <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
                    {t('setups.runningOn', {
                      server: serverName(run.serverId),
                      time: fmtTime(run.startedAt),
                    })}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1, mt: 'auto', pt: 0.5, flexWrap: 'wrap' }}>
                  {run ? (
                    <>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => onOpenServer(run.serverId)}
                        sx={{ borderRadius: radii.pill }}
                      >
                        {t('setups.openServer')}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={busy === run.serverId}
                        onClick={() => void stop(run.serverId)}
                        data-testid={`setup-stop-${s.id}`}
                        sx={{ borderRadius: radii.pill }}
                      >
                        {t('setups.stop')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="small"
                      variant="contained"
                      disabled={freeCount === 0 || busy === s.id}
                      onClick={() =>
                        void act(s.id, `/api/game/cs2/setups/${encodeURIComponent(s.id)}/start`)
                      }
                      data-testid={`setup-start-${s.id}`}
                      sx={{ borderRadius: radii.pill }}
                    >
                      {freeCount === 0 ? t('setups.noFreeServer') : t('setups.start')}
                    </Button>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <SetupEditor
        setup={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload();
        }}
      />
    </Box>
  );
}
