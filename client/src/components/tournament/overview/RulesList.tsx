import { Box, Stack, Typography } from '@mui/material';
import { fontMono } from '../../../theme/tokens';
import { ExternalLink } from '../../common/ExternalLink';

interface RulesListProps {
  rules: string[];
  rulebookUrl?: string;
  rulebookLinkLabel: string;
}

/** Numbered rules, plus an optional "Full rulebook" link. */
export function RulesList({ rules, rulebookUrl, rulebookLinkLabel }: RulesListProps) {
  if (rules.length === 0) return null;

  return (
    <Box data-testid="overview-rules">
      <Stack spacing={1.5} component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {rules.map((rule, index) => (
          <Box
            key={index}
            component="li"
            sx={{ display: 'grid', gridTemplateColumns: '2rem minmax(0, 1fr)', gap: 1.5 }}
          >
            <Typography
              component="span"
              color="text.secondary"
              sx={{ fontFamily: fontMono, fontWeight: 600 }}
            >
              {index + 1}
            </Typography>
            <Typography color="text.secondary">{rule}</Typography>
          </Box>
        ))}
      </Stack>
      {rulebookUrl && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          <ExternalLink href={rulebookUrl}>{rulebookLinkLabel}</ExternalLink>
        </Typography>
      )}
    </Box>
  );
}
