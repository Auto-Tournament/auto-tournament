import React, { useState } from 'react';
import { IconButton, Tooltip, Box } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { copyTeamMatchUrl, openTeamMatchInNewTab } from '../../utils/teamLinks';

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
  const [copied, setCopied] = useState(false);

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const success = await copyTeamMatchUrl(teamId);
    
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }

    if (onCopyClick) {
      onCopyClick(event);
    }
  };

  const handleOpenInNewTab = (event: React.MouseEvent) => {
    event.stopPropagation();
    openTeamMatchInNewTab(teamId);
  };

  return (
    <Box display="flex" gap={0.5}>
      <Tooltip title="Open team match page">
        <IconButton size={size} onClick={handleOpenInNewTab} color="primary">
          <OpenInNewIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={copied ? 'Copied!' : 'Copy team match link'}>
        <IconButton size={size} onClick={handleCopy} color={copied ? 'success' : 'default'}>
          <LinkIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

