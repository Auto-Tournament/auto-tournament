/**
 * The ? menu's HUD entry: how to update the in-game HUD addon, where the
 * in-game "HUD out of date" pill points. CS2 only updates the addon for
 * players subscribed to it: the server sends addon ids, and the game downloads
 * only ids it doesn't have, so a restart alone keeps the old copy (2026-11-10).
 */
import { Box, Button, Dialog, Typography } from '@mui/material';
import {
  ExternalLink,
  fontDisplay,
  radii,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';
import type { HelpMenuItemProps } from '../../types';

const { color } = tokens;

// The Auto Tournament HUD addon (ready-up hud/, plugins/addons kHudAddon).
const HUD_ADDON_ID = '3827905393';

export function HudUpdateDialog({ onClose }: HelpMenuItemProps) {
  const { t } = useModuleTranslation('cs2');
  const steps = [t('hudHelp.step1'), t('hudHelp.step2'), t('hudHelp.step3')];
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="hud-help-title"
      data-testid="hud-help-dialog"
      PaperProps={{
        sx: {
          borderRadius: radii.lg,
          bgcolor: color.paper,
          border: `1px solid ${color.rule}`,
          backgroundImage: 'none',
        },
      }}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography
          id="hud-help-title"
          component="h2"
          sx={{
            m: 0,
            fontFamily: fontDisplay,
            fontSize: '1.375rem',
            fontWeight: 700,
            color: color.ink,
          }}
        >
          {t('hudHelp.title')}
        </Typography>
        <Typography sx={{ color: color.ink2 }}>{t('hudHelp.body')}</Typography>
        <Box
          component="ol"
          sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}
        >
          {steps.map((step, i) => (
            <Typography component="li" key={i} sx={{ color: color.ink }}>
              {step}
              {i === 0 && (
                <Box
                  sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mt: 1 }}
                >
                  <Button
                    variant="contained"
                    size="small"
                    component="a"
                    href={`steam://url/CommunityFilePage/${HUD_ADDON_ID}`}
                  >
                    {t('hudHelp.openSteam')}
                  </Button>
                  <ExternalLink
                    href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${HUD_ADDON_ID}`}
                  >
                    {t('hudHelp.openWeb')}
                  </ExternalLink>
                </Box>
              )}
            </Typography>
          ))}
        </Box>
        <Button variant="outlined" onClick={onClose} sx={{ alignSelf: 'flex-end' }}>
          {t('hudHelp.done')}
        </Button>
      </Box>
    </Dialog>
  );
}
