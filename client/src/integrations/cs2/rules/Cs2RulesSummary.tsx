/**
 * "How matches are played", from the tournament's CS2 settings: the mode, the
 * rounds and how many win, when sides switch, what a tie leads to, the maps
 * (veto or drawn), and bots in empty seats. The Rules tab shows it in full and
 * the overview in one line, so players know how long they will play
 * (live test, 2026-10-15).
 */
import { Box, Typography } from '@mui/material';
import { useModuleTranslation, tokens, textSize } from '../../../module-sdk';
import type { TournamentRulesViewProps } from '../../types';
import { rulesLines, STRONG_END } from './rulesLines';

export function Cs2RulesSummary({ tournament, compact }: TournamentRulesViewProps) {
  const { t } = useModuleTranslation('cs2');
  const lines = rulesLines(t, tournament);
  if (compact) {
    return (
      <Typography
        data-testid="rules-summary-line"
        sx={{ color: tokens.color.ink2, fontSize: textSize.sm }}
      >
        {lines
          .slice(0, 3)
          .map((l) => l.replace(STRONG_END, ' '))
          .join(' · ')}
      </Typography>
    );
  }
  return (
    <Box
      component="ul"
      data-testid="rules-summary"
      sx={{ m: 0, pl: 2.5, display: 'grid', gap: 1, color: tokens.color.ink2, lineHeight: 1.6 }}
    >
      {lines.map((line) => {
        const [strong, rest] = line.includes(STRONG_END) ? line.split(STRONG_END) : [null, line];
        return (
          <li key={line}>
            {strong && (
              <Box component="strong" sx={{ color: tokens.color.ink }}>
                {strong}
              </Box>
            )}
            {strong ? ` ${rest}` : rest}
          </li>
        );
      })}
    </Box>
  );
}
