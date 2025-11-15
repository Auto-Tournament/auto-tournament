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

interface MatchRosterAccordionProps {
  team: Team | null;
  match: TeamMatchInfo;
}

export function MatchRosterAccordion({ team, match }: MatchRosterAccordionProps) {
  return (
    <Accordion sx={{ mb: 3 }}>
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
              }).map((_, idx) => (
                <TableRow key={idx}>
                  <TableCell sx={{ borderBottom: 'none', py: 1 }}>
                    <Typography variant="body2" color="primary.main" fontWeight={500}>
                      {team?.players && team.players[idx] ? team.players[idx].name : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ borderBottom: 'none', py: 1, textAlign: 'right' }}>
                    <Typography variant="body2" color="error.main" fontWeight={500}>
                      {match.config &&
                      (match.isTeam1 ? match.config.team2?.players : match.config.team1?.players)?.[
                        idx
                      ]
                        ? (match.isTeam1
                            ? match.config.team2?.players
                            : match.config.team1?.players)?.[idx].name
                        : '—'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </AccordionDetails>
    </Accordion>
  );
}

