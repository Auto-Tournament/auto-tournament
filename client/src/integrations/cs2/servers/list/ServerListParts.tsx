import { useState, type ReactNode } from 'react';
import { IconButton, ListItemIcon, Menu, MenuItem, Typography } from '@mui/material';
import { DotsThreeIcon } from '@phosphor-icons/react';
import { mono, radii, tokens, useModuleTranslation } from '../../../../module-sdk';
import type { FleetHost, FleetHostCommand } from '../../cs2.types';
import type { Fleet } from '../fleet/useFleet';
import type { ServerMatch } from '../fleet/useServerMatches';
import type { ServerGroup, ServerRow } from './serverGroups';

const { color } = tokens;

/** One entry of a row's menu. */
export interface ServerAction {
  id: string;
  label: string;
  testId?: string;
  danger?: boolean;
  icon?: ReactNode;
  run: () => void;
}

export interface MachineHandlers {
  onOpen: (host: FleetHost) => void;
  onMenu: (host: FleetHost, anchor: HTMLElement) => void;
  onAddServers: (host: FleetHost) => void;
  onUpdateGame: (host: FleetHost) => void;
  onUpdateReadyUp: (host: FleetHost) => void;
  onNewCode: (host: FleetHost) => void;
  onRetry: (host: FleetHost, command: FleetHostCommand) => void;
}

export interface ServerListProps {
  groups: ServerGroup[];
  fleet: Fleet;
  matches: Record<string, ServerMatch>;
  onOpen: (row: ServerRow) => void;
  machine: MachineHandlers;
}

export const DOT = { width: 8, height: 8, borderRadius: radii.pill, flex: 'none' } as const;

export const rowGrid = {
  display: 'grid',
  gridColumn: '1 / -1',
  gridTemplateColumns: 'subgrid',
  alignItems: 'center',
  columnGap: 1.5,
  rowGap: 0.25,
  px: 1.5,
  py: { xs: 1, md: 0.75 },
  minHeight: 44,
  cursor: 'pointer',
  gridTemplateAreas: {
    xs: '"dot name state actions" ". sub sub sub"',
    md: '"dot name state sub addr ver actions"',
  },
  borderTop: `1px solid ${color.rule}`,
  '&:first-of-type': { borderTop: 'none' },
  '&:hover': { bgcolor: color.paper3 },
} as const;

function lineDisplay(phoneOnly?: boolean, wide?: boolean) {
  if (phoneOnly) return { xs: 'block', md: 'none' };
  if (wide) return { xs: 'none', md: 'block' };
  return 'block';
}

export function Line({
  children,
  area,
  testId,
  phoneOnly,
  wide,
  monoText,
}: {
  children: ReactNode;
  area: string;
  testId?: string;
  phoneOnly?: boolean;
  wide?: boolean;
  monoText?: boolean;
}) {
  return (
    <Typography
      component="span"
      variant="caption"
      color="text.secondary"
      noWrap
      data-testid={testId}
      title={typeof children === 'string' ? children : undefined}
      sx={{
        gridArea: area,
        minWidth: 0,
        display: lineDisplay(phoneOnly, wide),
        ...(monoText ? mono : {}),
      }}
    >
      {children}
    </Typography>
  );
}

export function RowMenu({
  name,
  items,
  testId,
}: {
  name: string;
  items: ServerAction[];
  testId: string;
}) {
  const { t } = useModuleTranslation('cs2');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <IconButton
        size="small"
        aria-label={t('serversList.menu', { defaultValue: 'More for {{name}}', name })}
        onClick={(e) => setAnchor(e.currentTarget)}
        data-testid={testId}
      >
        <DotsThreeIcon size={18} weight="bold" />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {items.map((item) => (
          <MenuItem
            key={item.id}
            data-testid={item.testId}
            sx={item.danger ? { color: 'error.main' } : undefined}
            onClick={() => {
              setAnchor(null);
              item.run();
            }}
          >
            {item.icon && <ListItemIcon sx={{ color: 'inherit' }}>{item.icon}</ListItemIcon>}
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
