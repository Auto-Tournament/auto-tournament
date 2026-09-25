import React from 'react';
import { Box, Card, Typography, Button } from '@mui/material';
import type { IconComponent } from '../../theme/icons';

interface EmptyStateProps {
  icon: IconComponent;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: IconComponent;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
}) => {
  // Determine test ID based on title/content
  const getTestId = () => {
    const titleLower = title.toLowerCase();
    if (titleLower.includes('team')) return 'teams-empty-state';
    if (titleLower.includes('player')) return 'players-empty-state';
    if (titleLower.includes('server')) return 'servers-empty-state';
    if (titleLower.includes('map') && titleLower.includes('pool')) return 'map-pools-empty-state';
    if (titleLower.includes('map')) return 'maps-empty-state';
    if (titleLower.includes('match')) return 'matches-empty-state';
    if (titleLower.includes('bracket')) return 'bracket-empty-state';
    return 'empty-state';
  };

  return (
    <Card data-testid={getTestId()} sx={{ textAlign: 'center', py: 8 }}>
      {/* Sized in CSS as well as by `size`, so an icon that ignores `size` fits. */}
      <Box
        component={Icon}
        size={80}
        aria-hidden
        sx={{ width: 80, height: 80, color: 'text.secondary', mb: 2 }}
      />
      <Typography variant="h6" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={actionLabel ? 3 : 0}>
        {description}
      </Typography>
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
    </Card>
  );
};
