import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
  Box,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PeopleIcon from '@mui/icons-material/People';
import type { Team, TeamMatchInfo } from '../../types';
import { PlayerAvatar } from '../player/PlayerAvatar';

interface MatchRosterAccordionProps {
  team: Team | null;
  match: TeamMatchInfo;
}

export function MatchRosterAccordion({ team, match }: MatchRosterAccordionProps) {
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box display="flex" alignItems="center" gap={1}>
          <PeopleIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Players
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <TableContainer>
          <Table size="small">
            <TableBody>
              {Array.from({
                length: Math.max(
                  team?.players?.length || 0,
                  match.config
                    ? (match.isTeam1
                        ? match.config.team2?.players?.length
                        : match.config.team1?.players?.length) || 0
                    : 0
                ),
              }).map((_, idx) => {
                const teamPlayer = team?.players && team.players[idx];
                const opponentPlayer = match.config
                  ? (match.isTeam1 ? match.config.team2?.players : match.config.team1?.players)?.[idx]
                  : null;

                return (
                  <TableRow key={idx}>
                    <TableCell sx={{ borderBottom: 'none', py: 1 }}>
                      <Box display="flex" alignItems="center" gap={1}>
                        {teamPlayer && (
                          <PlayerAvatar
                            id={teamPlayer.steamId}
                            name={teamPlayer.name}
                            avatarUrl={teamPlayer.avatar}
                            size={24}
                          />
                        )}
                        <Typography variant="body2" color="primary.main" fontWeight={500}>
                          {teamPlayer ? teamPlayer.name : '—'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ borderBottom: 'none', py: 1, textAlign: 'right' }}>
                      <Box display="flex" alignItems="center" gap={1} justifyContent="flex-end">
                        <Typography variant="body2" color="error.main" fontWeight={500}>
                          {opponentPlayer ? opponentPlayer.name : '—'}
                        </Typography>
                        {opponentPlayer && (
                          <PlayerAvatar
                            id={opponentPlayer.steamid}
                            name={opponentPlayer.name}
                            avatarUrl={opponentPlayer.avatar}
                            size={24}
                          />
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </AccordionDetails>
    </Accordion>
  );
}

