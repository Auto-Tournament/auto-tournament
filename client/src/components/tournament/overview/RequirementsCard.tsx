import { Box, Card, CardContent, Link as MuiLink, Stack, Typography } from '@mui/material';
import { CheckIcon } from '@phosphor-icons/react';

export interface Requirement {
  label: string;
  /** 'ok' when the signed-in viewer already satisfies this; 'neutral' when signed out or unknown. */
  state: 'ok' | 'neutral';
}

interface RequirementsCardProps {
  title: string;
  requirements: Requirement[];
  manageLinkLabel?: string;
  manageLinkHref?: string;
}

/** "To take part" side card: what a player needs, with a check for what the viewer already has. */
export function RequirementsCard({
  title,
  requirements,
  manageLinkLabel,
  manageLinkHref,
}: RequirementsCardProps) {
  if (requirements.length === 0) return null;

  return (
    <Card data-testid="overview-requirements">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          {title}
        </Typography>
        <Stack spacing={1.5}>
          {requirements.map((req, index) => (
            <Box key={index} display="flex" gap={1} alignItems="flex-start">
              <Box
                sx={{
                  flex: '0 0 auto',
                  width: 20,
                  height: 20,
                  mt: 0.25,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: req.state === 'ok' ? 'success.main' : 'action.selected',
                  color: req.state === 'ok' ? 'success.contrastText' : 'text.secondary',
                }}
              >
                {req.state === 'ok' && <CheckIcon size={14} />}
              </Box>
              <Typography variant="body2" color="text.secondary">
                {req.label}
              </Typography>
            </Box>
          ))}
        </Stack>
        {manageLinkLabel && manageLinkHref && (
          <MuiLink
            href={manageLinkHref}
            variant="body2"
            sx={{ display: 'inline-block', mt: 1.5 }}
          >
            {manageLinkLabel}
          </MuiLink>
        )}
      </CardContent>
    </Card>
  );
}
