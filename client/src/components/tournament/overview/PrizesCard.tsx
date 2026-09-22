import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { fontDisplay } from '../../../theme/tokens';
import type { EventPagePrize } from '../../../types';

interface PrizesCardProps {
  title: string;
  prizes: EventPagePrize[];
  note?: string;
}

/**
 * Prizes side card. Hidden entirely when the organizer hasn't set any prizes
 * – the public page never shows "—" placeholders for unset values.
 */
export function PrizesCard({ title, prizes, note }: PrizesCardProps) {
  if (prizes.length === 0) return null;

  return (
    <Card data-testid="overview-prizes">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          {title}
        </Typography>
        <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }} spacing={0.5}>
          {prizes.map((prize, index) => (
            <Box
              key={index}
              component="li"
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 1.5,
                py: 0.5,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {prize.place}
              </Typography>
              <Typography sx={{ fontFamily: fontDisplay }} fontWeight={600}>
                {prize.prize || '—'}
              </Typography>
            </Box>
          ))}
        </Stack>
        {note && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {note}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
