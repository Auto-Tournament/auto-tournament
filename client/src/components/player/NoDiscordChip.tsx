import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface NoDiscordChipProps {
  testId?: string;
}

/**
 * Marks a player who has no Discord ID on record, so an admin can see at a
 * glance who cannot be reached on Discord.
 */
export const NoDiscordChip: React.FC<NoDiscordChipProps> = ({ testId }) => {
  const { t } = useTranslation();
  return (
    <Tooltip title={t('discordId.noDiscordTooltip')}>
      <Chip
        label={t('discordId.noDiscord')}
        size="small"
        variant="outlined"
        color="warning"
        data-testid={testId}
        sx={{ height: 20, fontSize: '0.7rem' }}
      />
    </Tooltip>
  );
};
