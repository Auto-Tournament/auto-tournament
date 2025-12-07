import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PersonIcon from '@mui/icons-material/Person';
import { useNavigate } from 'react-router-dom';

interface PlayerSearchResultsModalProps {
  open: boolean;
  players: Array<{ id: string; name: string; avatar?: string; currentElo?: number }>;
  onClose: () => void;
}

export default function PlayerSearchResultsModal({
  open,
  players,
  onClose,
}: PlayerSearchResultsModalProps) {
  const navigate = useNavigate();

  const handleSelectPlayer = (playerId: string) => {
    navigate(`/player/${playerId}`);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box display="flex" alignItems="center" gap={1}>
            <PersonIcon color="primary" />
            <Typography variant="h6">Multiple Players Found</Typography>
          </Box>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {players.length} players found. Select one to view their profile:
        </Typography>
        <List>
          {players.map((player) => (
            <ListItem key={player.id} disablePadding>
              <ListItemButton onClick={() => handleSelectPlayer(player.id)}>
                <ListItemAvatar>
                  <Avatar src={player.avatar} alt={player.name}>
                    {player.name.charAt(0).toUpperCase()}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={player.name}
                  secondary={
                    <Box>
                      <Typography variant="caption" component="span" display="block">
                        {player.id}
                      </Typography>
                      {player.currentElo !== undefined && (
                        <Typography variant="caption" component="span" color="primary">
                          ELO: {player.currentElo}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

