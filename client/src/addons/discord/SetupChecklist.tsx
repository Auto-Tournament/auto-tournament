import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Typography,
} from '@mui/material';
import { CaretDownIcon, CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { radii, tokens } from '../../theme/tokens';

const { color } = tokens;

export interface SetupState {
  category: boolean;
  results: boolean;
}

/**
 * Modules → Discord bot: what "Set up this server" makes, and which of it is
 * on the Discord server now (read from Discord each time the page loads).
 * Closed when all is there; open, with a button to make what is missing,
 * when something is not.
 */
export function SetupChecklist({
  state,
  busy,
  onSetUp,
}: {
  state: SetupState;
  busy: boolean;
  onSetUp: () => void;
}) {
  const { t } = useTranslation();
  const items: Array<{ key: keyof SetupState; label: string }> = [
    { key: 'category', label: t('discordBot.setup.category') },
    { key: 'results', label: t('discordBot.setup.results') },
  ];
  const missing = items.filter((i) => !state[i.key]).length;
  const none = missing === items.length;
  return (
    <Accordion
      disableGutters
      elevation={0}
      defaultExpanded={missing > 0}
      data-testid="discord-bot-setup-checklist"
      sx={{ mb: 2, maxWidth: 620, borderRadius: radii.md, '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<CaretDownIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {missing === 0 ? (
            <CheckCircleIcon color={color.live} weight="fill" />
          ) : (
            <WarningCircleIcon color={color.warning} weight="fill" />
          )}
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
            {missing === 0
              ? t('discordBot.setup.allThere')
              : t('discordBot.setup.missing', { count: missing })}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.75 }}>
          {items.map((i) => (
            <Box
              component="li"
              key={i.key}
              data-testid={`discord-bot-setup-${i.key}`}
              data-ok={state[i.key] ? 'true' : 'false'}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '0.875rem' }}
            >
              {state[i.key] ? (
                <CheckCircleIcon color={color.live} weight="fill" />
              ) : (
                <WarningCircleIcon color={color.warning} weight="fill" />
              )}
              {i.label}
              {!state[i.key] && (
                <Typography component="span" sx={{ fontSize: '0.8125rem', color: color.muted }}>
                  {t('discordBot.setup.notThere')}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
        <Typography sx={{ fontSize: '0.8125rem', color: color.muted, mt: 1.5 }}>
          {t('discordBot.setup.help')} {t('discordBot.setup.spaces')}
        </Typography>
        {missing > 0 && (
          <Button
            variant="outlined"
            disabled={busy}
            onClick={onSetUp}
            data-testid="discord-bot-setup"
            sx={{ borderRadius: radii.pill, mt: 1.5 }}
          >
            {none ? t('discordBot.setup.button') : t('discordBot.setup.fix')}
          </Button>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
