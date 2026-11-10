import React from 'react';
import { IconButton, Menu, MenuItem } from '@mui/material';
import { QuestionIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useInstalledIntegrations } from '../../integrations/registry';
import type { HelpMenuItemProps } from '../../integrations/types';
import { tokens } from '../../theme/tokens';

const { color } = tokens;

/**
 * The navbar's ? menu: modules' help entries (`helpMenuItem`; CS2: HUD, which
 * the in-game "HUD out of date" pill points to). Nothing when no module has one.
 */
export function HelpMenu() {
  const { t } = useTranslation();
  const items = useInstalledIntegrations().flatMap((integration) =>
    integration.helpMenuItem ? [{ ...integration.helpMenuItem, ns: integration.id }] : []
  );
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [OpenDialog, setOpenDialog] = React.useState<React.ComponentType<HelpMenuItemProps> | null>(
    null
  );
  if (items.length === 0) return null;
  return (
    <>
      <IconButton
        onClick={(e) => setAnchor(e.currentTarget)}
        size="small"
        aria-label={t('nav.help')}
        aria-haspopup="menu"
        aria-controls={anchor ? 'help-nav-menu' : undefined}
        aria-expanded={anchor ? 'true' : undefined}
        data-testid="nav-help"
        sx={{
          width: 36,
          height: 36,
          border: 1,
          borderColor: 'divider',
          color: anchor ? color.ink : color.ink2,
        }}
      >
        <QuestionIcon size={20} />
      </IconButton>
      <Menu
        id="help-nav-menu"
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {items.map((item) => (
          <MenuItem
            key={`${item.ns}:${item.key}`}
            onClick={() => {
              setAnchor(null);
              // A function in useState is called as an updater: wrap the component.
              setOpenDialog(() => item.Dialog);
            }}
            data-testid={`nav-help-${item.key}`}
          >
            {t(item.labelKey, { ns: item.ns })}
          </MenuItem>
        ))}
      </Menu>
      {OpenDialog && <OpenDialog onClose={() => setOpenDialog(null)} />}
    </>
  );
}
