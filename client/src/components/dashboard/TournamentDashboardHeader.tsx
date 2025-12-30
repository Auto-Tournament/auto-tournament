import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';

interface TournamentDashboardHeaderProps {
  tournamentName?: string;
}

export default function TournamentDashboardHeader({ tournamentName }: TournamentDashboardHeaderProps) {
  return (
    <Stack
      direction="row"
      sx={{
        display: { xs: 'none', md: 'flex' },
        width: '100%',
        alignItems: { xs: 'flex-start', md: 'center' },
        justifyContent: 'space-between',
        maxWidth: { sm: '100%', md: '1700px' },
        pt: 1.5,
      }}
      spacing={2}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          sx={{
            width: '1.5rem',
            height: '1.5rem',
            bgcolor: 'primary.main',
            borderRadius: '999px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            alignSelf: 'center',
          }}
        >
          <EmojiEventsRoundedIcon sx={{ fontSize: '1rem', color: 'primary.contrastText' }} />
        </Box>
        <Typography variant="h4" component="h1" sx={{ color: 'text.primary', fontWeight: 600 }}>
          {tournamentName || 'Tournament Dashboard'}
        </Typography>
      </Stack>
    </Stack>
  );
}

