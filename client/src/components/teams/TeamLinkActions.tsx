import React from 'react';
import { IconButton, Tooltip, Box } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { getTeamMatchUrl } from '../../utils/teamLinks';
import { useTeamLinkCopy } from '../../hooks/useTeamLinkCopy';

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
        <Tooltip title="Open team match page">
          <IconButton
            size={size}
            href={getTeamMatchUrl(teamId)}
            target="_blank"
            rel="noopener noreferrer"
            color="primary"
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Copy team match link">
          <IconButton size={size} onClick={handleCopy}>
            <LinkIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <ToastNotification />
    </>
  );
};
