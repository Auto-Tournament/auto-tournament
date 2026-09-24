import React from 'react';
import { IconButton, Tooltip, Box } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { getTeamMatchUrl } from '../../utils/teamLinks';
import { useTeamLinkCopy } from '../../hooks/useTeamLinkCopy';
import { useTranslation } from 'react-i18next';

interface TeamLinkActionsProps {
  teamId: string;
  onCopyClick?: (event: React.MouseEvent) => void;
  size?: 'small' | 'medium';
}

/**
 * Reusable team link action buttons
 * Provides copy and open in new tab functionality
 */
export const TeamLinkActions: React.FC<TeamLinkActionsProps> = ({
  teamId,
  onCopyClick,
  size = 'small',
}) => {
  const { copyLink, ToastNotification } = useTeamLinkCopy();
  const { t } = useTranslation();

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    await copyLink(teamId);

    if (onCopyClick) {
      onCopyClick(event);
    }
  };

  return (
    <>
      <Box display="flex" gap={0.5}>
        <Tooltip title={t('teamLinkActions.open')}>
          <IconButton
            size={size}
            href={getTeamMatchUrl(teamId)}
            target="_blank"
            rel="noopener noreferrer"
            color="primary"
            aria-label={t('teamLinkActions.open')}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('teamLinkActions.copy')}>
          <IconButton size={size} onClick={handleCopy} aria-label={t('teamLinkActions.copy')}>
            <LinkIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <ToastNotification />
    </>
  );
};
