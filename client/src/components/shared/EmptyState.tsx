import React from 'react';
import { Card, Typography, Button } from '@mui/material';
import { SvgIconComponent } from '@mui/icons-material';

interface EmptyStateProps {
  icon: SvgIconComponent;
  title: string;
  description: string;
  actionLabel?: string;
  actionIcon?: SvgIconComponent;
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
  return (
    <Card sx={{ textAlign: 'center', py: 8 }}>
      <Icon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
      <Typography variant="h6" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={actionLabel ? 3 : 0}>
        {description}
      </Typography>
      {actionLabel && onAction && (
        <Button
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
