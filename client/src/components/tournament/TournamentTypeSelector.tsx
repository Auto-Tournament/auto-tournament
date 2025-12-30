import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  Chip,
  Stack,
} from '@mui/material';
import {
  EmojiEvents,
  WorkspacePremium,
  Groups,
  Shuffle,
  Casino,
} from '@mui/icons-material';
import { TOURNAMENT_TYPES, TOURNAMENT_CATEGORIES, type TournamentType } from '../../constants/tournament';

interface TournamentTypeSelectorProps {
  selectedType: string;
  onTypeChange: (type: string) => void;
  disabled?: boolean;
}

const iconMap: Record<string, React.ComponentType> = {
  EmojiEvents,
  WorkspacePremium,
  Groups,
  Shuffle,
  Casino,
};

export function TournamentTypeSelector({
  selectedType,
  onTypeChange,
  disabled = false,
}: TournamentTypeSelectorProps) {
  const getIcon = (iconName?: string) => {
    if (!iconName) return null;
    const IconComponent = iconMap[iconName];
    return IconComponent ? <IconComponent /> : null;
  };

  const typesByCategory = TOURNAMENT_CATEGORIES.map((category) => ({
    ...category,
    types: TOURNAMENT_TYPES.filter((type) => type.category === category.id && !type.disabled),
  }));

  return (
    <Box data-testid="tournament-type-selector">
      {typesByCategory.map((category) => {
        if (category.types.length === 0) return null;

        return (
          <Box key={category.id} sx={{ mb: 3 }}>
            <Typography variant="h6" fontWeight={600} mb={2}>
              {category.label}
            </Typography>

            <Grid container spacing={2}>
              {category.types.map((type: TournamentType) => {
                const isSelected = selectedType === type.value;
                const Icon = type.icon ? getIcon(type.icon) : null;

                return (
                  <Grid size={{ xs: 12, sm: 6 }} key={type.value}>
                    <Card
                      data-testid={type.value === 'shuffle' ? 'tournament-type-option-shuffle' : `tournament-type-option-${type.value}`}
                      sx={{
                        height: '100%',
                        border: '2px solid',
                        borderColor: isSelected ? 'primary.main' : 'transparent',
                        bgcolor: isSelected ? 'action.selected' : 'background.paper',
                        transition: 'border-color 0.2s, background-color 0.2s',
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          boxShadow: 4,
                          borderColor: isSelected ? 'primary.main' : 'divider',
                        },
                        opacity: disabled ? 0.6 : 1,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <CardActionArea
                        onClick={() => !disabled && onTypeChange(type.value)}
                        disabled={disabled}
                        sx={{ height: '100%', p: 2 }}
                      >
                        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                          <Stack spacing={1.5}>
                            <Box display="flex" alignItems="center" gap={1.5}>
                              {Icon && (
                                <Box
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 48,
                                    height: 48,
                                    borderRadius: 1,
                                    bgcolor: isSelected ? 'primary.main' : 'action.hover',
                                    color: isSelected ? 'primary.contrastText' : 'text.primary',
                                  }}
                                >
                                  {Icon}
                                </Box>
                              )}
                              <Box flex={1}>
                                <Typography variant="h6" fontWeight={600}>
                                  {type.label}
                                </Typography>
                              </Box>
                              {isSelected && (
                                <Chip
                                  label="Selected"
                                  size="small"
                                  color="primary"
                                  sx={{ height: 24 }}
                                />
                              )}
                            </Box>

                            <Typography variant="body2" color="text.secondary">
                              {type.description}
                            </Typography>
                          </Stack>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        );
      })}
    </Box>
  );
}

