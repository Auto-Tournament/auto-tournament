import React, { useId, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { DotsThreeIcon } from '@phosphor-icons/react';

export type RowMenuItem = {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Runs after the menu closes. */
  onClick?: () => void;
  /** An in-app route, instead of `onClick`. */
  to?: string;
  /** An address outside the app, opened in a new tab, instead of `onClick`. */
  href?: string;
  /** Destructive: drawn in the ban colour. */
  danger?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
};

export type RowMenuProps = {
  items: RowMenuItem[];
  /** The button's accessible name, e.g. "Actions for Nordlys". */
  label: string;
  'data-testid'?: string;
};

/**
 * A row's actions behind one quiet "…" button (the audit's "row actions in a
 * row menu"), so a `RowList` row carries one control instead of a strip of
 * icon buttons. Clicks inside it never reach the row, so a row that opens
 * something on click keeps working around it.
 */
export function RowMenu({ items, label, ...rest }: RowMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const visible = items;
  if (visible.length === 0) return null;

  const close = () => setAnchor(null);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <>
      <IconButton
        size="small"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        aria-controls={anchor ? menuId : undefined}
        data-testid={rest['data-testid']}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        onKeyDown={stop}
      >
        <DotsThreeIcon size={20} />
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        onClick={stop}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {visible.map((item) => {
          const linkProps = item.to
            ? { component: RouterLink, to: item.to }
            : item.href
              ? { component: 'a' as const, href: item.href, target: '_blank', rel: 'noopener noreferrer' }
              : {};
          return (
            <MenuItem
              key={item.key}
              {...linkProps}
              disabled={item.disabled}
              data-testid={item['data-testid']}
              onClick={() => {
                close();
                item.onClick?.();
              }}
              sx={item.danger ? { color: 'error.main' } : undefined}
            >
              {item.icon && (
                <ListItemIcon sx={item.danger ? { color: 'inherit' } : undefined}>{item.icon}</ListItemIcon>
              )}
              <ListItemText>{item.label}</ListItemText>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
