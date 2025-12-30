import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { api } from '../../utils/api';
import MatchDetailsModal from '../modals/MatchDetailsModal';
import type { Match } from '../../types';
import { getRoundLabel } from '../../utils/matchUtils';

interface PlayerMatchDetailsModalProps {
  open: boolean;
  matchSlug: string | null;
  round: number;
  matchNumber: number;
  onClose: () => void;
}

export const PlayerMatchDetailsModal: React.FC<PlayerMatchDetailsModalProps> = ({
  open,
  matchSlug,
  round,
  matchNumber,
  onClose,
}) => {
  const [match, setMatch] = useState<Match | null>(null);

  useEffect(() => {
    if (!open || !matchSlug) {
      return;
    }

    const loadMatch = async () => {
      try {
        const response = await api.get<{ success: boolean; match: Match }>(
          `/api/matches/${matchSlug}`
        );
        if (response && response.match) {
          setMatch(response.match);
        }
      } catch (err) {
        console.error('Failed to load match for player modal', err);
      }
    };

    void loadMatch();
  }, [open, matchSlug]);

  const handleClose = () => {
    setMatch(null);
    onClose();
  };

  if (!open) return null;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogContent sx={{ p: 0 }}>
        <MatchDetailsModal
          match={match}
          matchNumber={matchNumber}
          roundLabel={getRoundLabel(round)}
          onClose={handleClose}
        />
      </DialogContent>
    </Dialog>
  );
};


