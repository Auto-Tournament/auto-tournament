/**
 * The profile's Config tab: a player's CS2 config as Ready Up read it from their game during a
 * match here (the crosshair code and a fixed list of cvars), the gear and screen they typed in
 * themselves, and an autoexec.cfg to download. On their own profile, the switch that shows or
 * hides it, and the gear form. API: /api/game/cs2/players/:id/config (routes/playerConfig.ts).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';
import {
  api,
  apiErrorMessage,
  mono,
  Panel,
  radii,
  SwitchRow,
  textSize,
  tokens,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import type { PlayerProfileTabProps } from '../../types';
import { GearForm, GEAR_TEXT, type Gear } from './Cs2ConfigGearForm';
import {
  CrosshairColour,
  CrosshairPreview,
  GROUPS,
  PREVIEW_BACKGROUNDS,
  Spec,
} from './Cs2ConfigParts';
import { decodeCrosshairCode } from './crosshairCode';

interface ConfigResponse {
  own: boolean;
  hidden: boolean;
  show?: boolean;
  crosshairCode?: string | null;
  cvars?: Record<string, string>;
  gear?: Gear;
  readAt?: number | null;
}

const url = (playerId: string) => `/api/game/cs2/players/${encodeURIComponent(playerId)}/config`;

function hasAnything(c: ConfigResponse | null): boolean {
  if (!c || c.hidden) return false;
  return (
    !!c.crosshairCode ||
    Object.keys(c.cvars ?? {}).length > 0 ||
    Object.keys(c.gear ?? {}).length > 0
  );
}

export function Cs2ConfigTab({ playerId, isOwn, probe, onAvailability }: PlayerProfileTabProps) {
  const { t, i18n } = useModuleTranslation('cs2');
  const { showError, showSuccess } = useSnackbar();
  const [loaded, setLoaded] = useState<{ playerId: string; config: ConfigResponse } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ConfigResponse>(url(playerId))
      .then((r) => {
        if (cancelled) return;
        setLoaded({ playerId, config: r });
        onAvailability?.(r.own || hasAnything(r));
      })
      .catch(() => !cancelled && onAvailability?.(!!isOwn));
    return () => {
      cancelled = true;
    };
    // onAvailability is the page's callback; the tab is asked again when the player changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const config = loaded?.playerId === playerId ? loaded.config : null;
  if (probe || !config) return null;

  const save = async (body: { show?: boolean; gear?: Gear }) => {
    try {
      const r = await api.put<ConfigResponse>('/api/game/cs2/players/me/config', body);
      setLoaded({ playerId, config: r });
      showSuccess(t('config.saved'));
    } catch (error) {
      showError(apiErrorMessage(error, t('config.saveFailed')));
    }
  };

  const cvars = config.cvars ?? {};
  const gear = config.gear ?? {};
  const code = config.crosshairCode ?? null;
  const crosshair = decodeCrosshairCode(code);
  const read = !!code || Object.keys(cvars).length > 0;
  const own = config.own;
  const onOff = (v: string) => {
    if (v === '0') return t('config.off');
    if (v === '1') return t('config.on');
    return v;
  };
  const BOOL = new Set([
    'cl_crosshairdot',
    'cl_crosshair_drawoutline',
    'cl_crosshair_t',
    'cl_prefer_lefthanded',
    'cl_radar_always_centered',
    'cl_radar_rotate',
    'cl_radar_square_with_scoreboard',
  ]);
  const value = (cvar: string) => (BOOL.has(cvar) ? onOff(cvars[cvar]) : cvars[cvar]);
  const sens = Number(cvars.sensitivity);
  const edpi = gear.dpi && Number.isFinite(sens) ? Math.round(sens * gear.dpi) : null;
  const per360 =
    gear.dpi && Number.isFinite(sens) && sens > 0 ? (360 / (0.022 * sens * gear.dpi)) * 2.54 : null;
  const when = (at: number) =>
    new Date(at * 1000).toLocaleString(i18n.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showSuccess(t('config.copied'));
    } catch {
      showError(code);
    }
  };

  const playerMark = (
    <Box
      component="span"
      sx={{ fontFamily: 'inherit', fontSize: textSize.xs, color: 'text.secondary', mr: 1 }}
    >
      {t('config.setByPlayer')}
    </Box>
  );

  const groups = GROUPS.map((g) => ({ ...g, rows: g.cvars.filter((c) => cvars[c] !== undefined) }));
  const gearRows = GEAR_TEXT.filter((k) => gear[k]);

  return (
    <Box data-testid="cs2-config-tab" sx={{ display: 'grid', gap: 5 }}>
      {own && (
        <Box sx={{ pb: 3, borderBottom: `1px solid ${tokens.color.rule}` }}>
          <SwitchRow
            label={t('config.show')}
            help={t('config.showHelp')}
            checked={config.show !== false}
            onChange={(_, checked) => void save({ show: checked })}
            data-testid="cs2-config-show"
          />
        </Box>
      )}

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography sx={{ fontSize: textSize.sm, color: 'text.secondary' }}>
          {read && config.readAt
            ? t(own ? 'config.readAtOwn' : 'config.readAt', { date: when(config.readAt) })
            : t('config.notRead')}
        </Typography>
        {read && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {code && (
              <Button variant="outlined" size="small" onClick={() => void copyCode()}>
                {t('config.copyCode')}
              </Button>
            )}
            <Button
              variant="contained"
              size="small"
              component="a"
              href={`${url(playerId)}/autoexec.cfg`}
              download
            >
              {t('config.download')}
            </Button>
          </Box>
        )}
      </Box>

      {code && (
        <Panel sx={{ p: 3, borderRadius: radii.lg }}>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 600 }}>
            {t('config.crosshair')}
          </Typography>
          {crosshair && (
            <Box
              sx={{ display: 'flex', gap: 1.5, mt: 2, flexWrap: 'wrap' }}
              data-testid="cs2-config-crosshair-preview"
            >
              {PREVIEW_BACKGROUNDS.map((bg, i) => (
                <Box key={bg} component="figure" sx={{ m: 0, flex: '1 1 180px', minWidth: 0 }}>
                  <CrosshairPreview
                    crosshair={crosshair}
                    background={bg}
                    label={t(i === 0 ? 'config.previewDark' : 'config.previewBright')}
                  />
                  <Typography
                    component="figcaption"
                    sx={{ fontSize: textSize.xs, color: 'text.secondary', mt: 1 }}
                  >
                    {t(i === 0 ? 'config.previewDark' : 'config.previewBright')}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              mt: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box
              component="code"
              sx={{ ...mono, fontSize: textSize.lg, overflowWrap: 'anywhere', minWidth: 0 }}
            >
              {code}
            </Box>
            <Button size="small" variant="outlined" onClick={() => void copyCode()}>
              {t('config.copy')}
            </Button>
          </Box>
          {groups[0].rows.length > 0 && (
            <Spec
              rows={[
                ...groups[0].rows.map((c) => ({ k: c, v: value(c) })),
                ...(cvars.cl_crosshaircolor_r !== undefined
                  ? [{ k: 'cl_crosshaircolor_r g b', v: <CrosshairColour cvars={cvars} /> }]
                  : []),
              ]}
            />
          )}
        </Panel>
      )}

      {(groups.slice(1).some((g) => g.rows.length > 0) || gear.dpi || gear.resolution) && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
            gap: '40px 56px',
          }}
        >
          {groups.slice(1).map((g) => {
            const extra: Array<{ k: ReactNode; v: ReactNode }> = [];
            if (g.key === 'mouse') {
              if (gear.dpi)
                extra.push({
                  k: t('config.dpi'),
                  v: (
                    <>
                      {playerMark}
                      {gear.dpi}
                    </>
                  ),
                });
              if (gear.pollingHz)
                extra.push({
                  k: t('config.pollingHz'),
                  v: (
                    <>
                      {playerMark}
                      {gear.pollingHz} Hz
                    </>
                  ),
                });
              if (per360) extra.push({ k: t('config.per360'), v: `${per360.toFixed(1)} cm` });
            }
            if (g.key === 'video') {
              if (gear.resolution)
                extra.push({
                  k: t('config.resolution'),
                  v: (
                    <>
                      {playerMark}
                      {gear.resolution}
                    </>
                  ),
                });
              if (gear.scaling)
                extra.push({
                  k: t('config.scaling'),
                  v: (
                    <>
                      {playerMark}
                      {t(`config.scaling_${gear.scaling}`)}
                    </>
                  ),
                });
              if (gear.refreshHz)
                extra.push({
                  k: t('config.refreshHz'),
                  v: (
                    <>
                      {playerMark}
                      {gear.refreshHz} Hz
                    </>
                  ),
                });
            }
            const rows = [
              ...g.rows.map((c) => ({ k: c as ReactNode, v: value(c) as ReactNode })),
              ...extra,
            ];
            if (rows.length === 0) return null;
            return (
              <Box
                component="section"
                key={g.key}
                sx={{ minWidth: 0 }}
                aria-label={t(`config.${g.key}`)}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 1.5,
                  }}
                >
                  <Typography component="h3" sx={{ fontWeight: 600 }}>
                    {t(`config.${g.key}`)}
                  </Typography>
                  {g.key === 'mouse' && edpi !== null && (
                    <Typography
                      component="span"
                      sx={{ fontSize: textSize.sm, color: 'text.secondary' }}
                    >
                      {t('config.edpi')}{' '}
                      <Box
                        component="strong"
                        sx={{ color: 'text.primary', fontSize: textSize.lg, ml: 0.5 }}
                      >
                        {edpi}
                      </Box>
                    </Typography>
                  )}
                </Box>
                <Spec rows={rows} />
              </Box>
            );
          })}
        </Box>
      )}

      {gearRows.length > 0 && (
        <Box component="section" aria-label={t('config.gear')}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 1.5,
            }}
          >
            <Typography component="h3" sx={{ fontWeight: 600 }}>
              {t('config.gear')}
            </Typography>
            <Typography sx={{ fontSize: textSize.xs, color: 'text.secondary' }}>
              {t('config.setByPlayer')}
            </Typography>
          </Box>
          <Box
            component="dl"
            sx={{
              m: 0,
              mt: 1.5,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
              borderTop: `1px solid ${tokens.color.rule}`,
            }}
          >
            {gearRows.map((k) => (
              <Box key={k} sx={{ pt: 2, pr: 2 }}>
                <Box component="dt" sx={{ fontSize: textSize.xs, color: 'text.secondary' }}>
                  {t(`config.${k}`)}
                </Box>
                <Box component="dd" sx={{ m: 0, mt: 0.75, fontWeight: 500 }}>
                  {gear[k]}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {own && (
        <GearForm key={JSON.stringify(gear)} gear={gear} onSave={(g) => void save({ gear: g })} />
      )}

      {read && (
        <Typography sx={{ fontSize: textSize.sm, color: 'text.secondary', maxWidth: '65ch' }}>
          {t('config.downloadNote')}
        </Typography>
      )}
    </Box>
  );
}
