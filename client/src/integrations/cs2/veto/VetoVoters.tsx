import { Box } from '@mui/material';
import { AnimatePresence, motion } from 'motion/react';
import { PlayerAvatar, tokens } from '../../../module-sdk';

const { color } = tokens;

export interface VetoVoter {
  id: string;
  name: string;
  avatarUrl: string | null;
  team: 'team1' | 'team2';
}

/**
 * A matchmaking veto vote: the avatars of the players who voted for a map (or a side),
 * stacked; they move as votes change. The count is how many there are.
 */
export function VetoVoters({ voters, testId }: { voters: VetoVoter[]; testId?: string }) {
  return (
    <Box
      data-testid={testId}
      data-votes={voters.length}
      aria-label={voters.map((v) => v.name).join(', ')}
      sx={{ display: 'flex', alignItems: 'center', minHeight: 26, ml: 'auto' }}
    >
      <AnimatePresence initial={false}>
        {voters.map((v, i) => (
          <Box
            key={v.id}
            component={motion.div}
            layout
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            sx={{
              ml: i === 0 ? 0 : -1,
              borderRadius: '50%',
              boxShadow: `0 0 0 2px ${color.paper}`,
              display: 'flex',
            }}
            title={v.name}
          >
            <PlayerAvatar
              id={v.id}
              name={v.name}
              avatarUrl={v.avatarUrl}
              size={24}
              presence={false}
            />
          </Box>
        ))}
      </AnimatePresence>
    </Box>
  );
}
