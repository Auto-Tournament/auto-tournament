/**
 * Account page: the in-game HUD on Ready Up servers, or chat only. Two cards, each a small drawing of
 * what you see in game, the chosen one marked. Saved with PUT /api/me/hud; game servers get it per
 * player at the next match (hud:false). In game, `.hud` switches it for the session.
 */
import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { fontDisplay, tokens } from '../../theme/tokens';
import { apiErrorMessage } from '../../utils/api';

const { color } = tokens;
const ORANGE = '#ff6a3d';
// The game's own look in the drawings, the same in light and dark (it is a screenshot of CS2).
const SCENE = 'linear-gradient(160deg, #6b5a4c 0%, #3b332d 55%, #241f1b 100%)';
const PANEL = 'rgba(20, 14, 12, 0.9)';
const INK = '#f4edeb';

/** A 16:9 game scene with what the option shows drawn on it. */
function Scene({ children }: { children: React.ReactNode }) {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        borderRadius: 1.5,
        overflow: 'hidden',
        background: SCENE,
        fontFamily: '"Noto Sans", system-ui, sans-serif',
        color: INK,
      }}
    >
      {/* the crosshair, for scale */}
      <Box sx={{ position: 'absolute', left: '50%', top: '50%', width: 8, height: 8, ml: '-4px', mt: '-4px', border: '1px solid #7fd3ff', borderRadius: '50%' }} />
      {children}
    </Box>
  );
}

function HudPreview({ t }: { t: (k: string) => string }) {
  return (
    <Scene>
      {/* the menu list on the left */}
      <Box sx={{ position: 'absolute', left: 0, top: '22%', width: '30%', bgcolor: PANEL, borderRadius: '0 6px 6px 0', py: 0.75 }}>
        <Typography sx={{ fontSize: 9, fontWeight: 700, color: ORANGE, px: 1, mb: 0.5 }}>{t('account.hud.previewMenu')}</Typography>
        {[0, 1, 2].map((i) => (
          <Box key={i} sx={{ height: 9, mx: 0, mb: 0.35, bgcolor: i === 0 ? 'rgba(255,106,61,0.25)' : 'transparent', borderLeft: i === 0 ? `2px solid ${ORANGE}` : '2px solid transparent', display: 'flex', alignItems: 'center', px: 1 }}>
            <Box sx={{ height: 3, width: `${60 - i * 12}%`, bgcolor: 'rgba(244,237,235,0.7)', borderRadius: 1 }} />
          </Box>
        ))}
      </Box>
      {/* the Hold E chip under the crosshair */}
      <Box sx={{ position: 'absolute', left: '50%', top: '62%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25, borderRadius: 9, bgcolor: PANEL, border: `1px solid ${ORANGE}`, whiteSpace: 'nowrap' }}>
        <Box component="span" sx={{ fontSize: 8, border: '1px solid rgba(244,237,235,0.6)', borderRadius: 0.5, px: 0.4, lineHeight: 1.2 }}>E</Box>
        <Box component="span" sx={{ fontSize: 9, fontWeight: 700 }}>{t('account.hud.previewReady')}</Box>
      </Box>
      {/* the damage card on the right */}
      <Box sx={{ position: 'absolute', right: '3%', top: '58%', width: '30%', bgcolor: PANEL, borderRadius: 1, p: 0.5, borderBottom: `2px solid ${ORANGE}` }}>
        {[0, 1].map((i) => (
          <Box key={i} sx={{ height: 3, width: i ? '55%' : '80%', bgcolor: 'rgba(244,237,235,0.6)', borderRadius: 1, mb: 0.5 }} />
        ))}
      </Box>
    </Scene>
  );
}

function ChatPreview({ t }: { t: (k: string) => string }) {
  return (
    <Scene>
      {/* the chat, bottom left: Ready Up's lines in light red, a tip with the star */}
      <Box sx={{ position: 'absolute', left: '3%', bottom: '6%', width: '70%', bgcolor: 'rgba(0,0,0,0.45)', borderRadius: 0.5, p: 0.6, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography sx={{ fontSize: 9, fontWeight: 600, lineHeight: 1.3 }}>
          <Box component="span" sx={{ color: '#f2605f' }}>[Ready Up]</Box> {t('account.hud.previewChatReady')}
        </Typography>
        <Typography sx={{ fontSize: 9, fontWeight: 600, lineHeight: 1.3 }}>
          <Box component="span" sx={{ color: '#f2605f' }}>★</Box> {t('account.hud.previewChatTip')}
        </Typography>
      </Box>
    </Scene>
  );
}

export function IngameHudSetting() {
  const { t } = useTranslation();
  const { showError, showSnackbar } = useSnackbar();
  const [on, setOn] = React.useState<boolean | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void fetch('/api/me/hud', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ on: boolean }>) : { on: true }))
      .then((b) => setOn(b.on !== false))
      .catch(() => setOn(true));
  }, []);

  const save = async (next: boolean) => {
    if (next === on || saving) return;
    const before = on;
    setOn(next);
    setSaving(true);
    try {
      const res = await fetch('/api/me/hud', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next }),
      });
      if (!res.ok)
        throw new Error(apiErrorMessage(new Error(await res.text()), t('account.hud.saveFailed')));
      showSnackbar(t('account.hud.saved'), 'success');
    } catch (error) {
      setOn(before);
      showError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const options: { value: boolean; title: string; hint: string; preview: React.ReactNode }[] = [
    { value: true, title: t('account.hud.optionHud'), hint: t('account.hud.optionHudHint'), preview: <HudPreview t={t} /> },
    { value: false, title: t('account.hud.optionChat'), hint: t('account.hud.optionChatHint'), preview: <ChatPreview t={t} /> },
  ];

  return (
    <Box component="section" aria-labelledby="account-ingame-hud" sx={{ mt: 6 }} data-testid="ingame-hud-setting">
      <Typography id="account-ingame-hud" component="h2" variant="h6" sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
        {t('account.hud.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '62ch' }}>
        {t('account.hud.description')}
      </Typography>
      {on !== null && (
        <Box role="radiogroup" aria-labelledby="account-ingame-hud" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, maxWidth: 720 }}>
          {options.map((o) => {
            const chosen = on === o.value;
            return (
              <ButtonBase
                key={String(o.value)}
                role="radio"
                aria-checked={chosen}
                disabled={saving}
                onClick={() => void save(o.value)}
                data-testid={o.value ? 'ingame-hud-on' : 'ingame-hud-off'}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  gap: 1,
                  p: 1.25,
                  borderRadius: 2,
                  border: '2px solid',
                  borderColor: chosen ? ORANGE : color.rule,
                  bgcolor: chosen ? 'rgba(255,106,61,0.06)' : 'transparent',
                  transition: 'border-color 120ms',
                  '&:hover': { borderColor: chosen ? ORANGE : color.muted },
                  '&.Mui-focusVisible': { outline: `2px solid ${ORANGE}`, outlineOffset: 2 },
                }}
              >
                {o.preview}
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>{o.title}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{o.hint}</Typography>
                </Box>
              </ButtonBase>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
