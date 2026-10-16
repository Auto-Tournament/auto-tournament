import React from 'react';
import { Button } from '@mui/material';
import type { IconComponent } from '../../theme/icons';
import { EmptyPanel } from '../common/ui';

interface EmptyStateProps {
  /** Kept for older callers; the 3.0 empty state has no big icon. */
  icon?: IconComponent;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: IconComponent;
  onAction?: () => void;
}

/** The test id older pages and tests look for, from the title. */
function testIdOf(title: string): string {
  const titleLower = title.toLowerCase();
  if (titleLower.includes('team')) return 'teams-empty-state';
  if (titleLower.includes('player')) return 'players-empty-state';
  if (titleLower.includes('server')) return 'servers-empty-state';
  if (titleLower.includes('map') && titleLower.includes('pool')) return 'map-pools-empty-state';
  if (titleLower.includes('map')) return 'maps-empty-state';
  if (titleLower.includes('match')) return 'matches-empty-state';
  if (titleLower.includes('bracket')) return 'bracket-empty-state';
  return 'empty-state';
}

/**
 * Nothing to show yet, as the one empty panel (common/ui EmptyPanel) with an
 * optional action. The older call shape; new code uses EmptyPanel directly.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
}) => (
  <EmptyPanel title={title} description={description} data-testid={testIdOf(title)}>
    {actionLabel && onAction && (
      <Button
        data-testid="empty-state-action"
        variant="contained"
        startIcon={ActionIcon ? <ActionIcon /> : undefined}
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    )}
  </EmptyPanel>
);
