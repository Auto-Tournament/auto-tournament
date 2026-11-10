/**
 * CS2's entries in the navbar's ? menu (`helpMenuItems`): short answers to what
 * players get stuck on, each with the one action that fixes it.
 */
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Dialog, Typography } from '@mui/material';
import {
  ExternalLink,
  fontDisplay,
  links,
  mono,
  radii,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';
import type { HelpMenuItemProps } from '../../types';

const { color } = tokens;

// The Auto Tournament HUD addon (ready-up hud/, plugins/addons kHudAddon).
const HUD_ADDON_ID = '3827905393';

function HelpDialog({
  id,
  onClose,
  children,
}: HelpMenuItemProps & { id: string; children: ReactNode }) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby={`help-${id}-title`}
      data-testid={`help-${id}-dialog`}
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
          id={`help-${id}-title`}
          component="h2"
          sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 700 }}
        >
          {t(`help.${id}.title`)}
        </Typography>
        <Typography sx={{ color: color.ink2 }}>{t(`help.${id}.body`)}</Typography>
        {children}
        <Button variant="outlined" onClick={onClose} sx={{ alignSelf: 'flex-end' }}>
          {t('help.done')}
        </Button>
      </Box>
    </Dialog>
  );
}

/** Numbered steps; `actions[i]` goes under step i. */
function Steps({ steps, actions = {} }: { steps: string[]; actions?: Record<number, ReactNode> }) {
  return (
    <Box component="ol" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {steps.map((step, i) => (
        <Typography component="li" key={i}>
          {step}
          {actions[i] && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mt: 1 }}>
              {actions[i]}
            </Box>
          )}
        </Typography>
      ))}
    </Box>
  );
}

/**
 * HUD: where the in-game "HUD out of date" pill points. CS2 only updates the
 * addon for players subscribed to it: the server sends addon ids, and the game
 * downloads only ids it doesn't have, so a restart keeps the old copy.
 */
export function HudHelp({ onClose }: HelpMenuItemProps) {
  const { t } = useModuleTranslation('cs2');
  return (
    <HelpDialog id="hud" onClose={onClose}>
      <Steps
        steps={[t('help.hud.step1'), t('help.hud.step2'), t('help.hud.step3')]}
        actions={{
          0: (
            <>
              <Button
                variant="contained"
                size="small"
                component="a"
                href={`steam://url/CommunityFilePage/${HUD_ADDON_ID}`}
              >
                {t('help.hud.openSteam')}
              </Button>
              <ExternalLink
                href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${HUD_ADDON_ID}`}
              >
                {t('help.hud.openWeb')}
              </ExternalLink>
            </>
          ),
        }}
      />
    </HelpDialog>
  );
}

/** Can't connect: the match room has the address and password, and the LAN / internet switch. */
export function ConnectHelp({ onClose }: HelpMenuItemProps) {
  const { t } = useModuleTranslation('cs2');
  return (
    <HelpDialog id="connect" onClose={onClose}>
      <Steps
        steps={[
          t('help.connect.step1'),
          t('help.connect.step2'),
          t('help.connect.step3'),
          t('help.connect.step4'),
        ]}
        actions={{
          0: (
            <Button
              variant="contained"
              size="small"
              component={RouterLink}
              to={links.matchNow()}
              onClick={onClose}
            >
              {t('help.connect.openMatch')}
            </Button>
          ),
        }}
      />
    </HelpDialog>
  );
}

// The chat commands a player needs (Ready Up's own `.help` lists the rest).
const COMMANDS = ['r', 'ur', 'p', 'up', 'tac', 'stay', 'admin', 'lang', 'help'];

/** In-game commands, typed in CS2's chat. */
export function CommandsHelp({ onClose }: HelpMenuItemProps) {
  const { t } = useModuleTranslation('cs2');
  return (
    <HelpDialog id="commands" onClose={onClose}>
      <Box
        component="dl"
        sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 1 }}
      >
        {COMMANDS.map((cmd) => (
          <Box key={cmd} sx={{ display: 'contents' }}>
            <Box component="dt" sx={{ ...mono, color: color.ink, whiteSpace: 'nowrap' }}>
              {`.${cmd}`}
            </Box>
            <Box component="dd" sx={{ m: 0, color: color.ink2 }}>
              {t(`help.commands.what.${cmd}`)}
            </Box>
          </Box>
        ))}
      </Box>
    </HelpDialog>
  );
}

/** Stats or clips missing: when each arrives, and why clips can be missing. */
export function ClipsHelp({ onClose }: HelpMenuItemProps) {
  const { t } = useModuleTranslation('cs2');
  return (
    <HelpDialog id="clips" onClose={onClose}>
      <Steps steps={[t('help.clips.step1'), t('help.clips.step2'), t('help.clips.step3')]} />
    </HelpDialog>
  );
}
