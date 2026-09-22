import { FormControl, FormHelperText, InputLabel, MenuItem, Select, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { EloCalculationTemplate } from '../../../types/elo.types';

export const DEFAULT_ELO_TEMPLATE_ID = 'pure-win-loss';

interface EloTemplateSelectProps {
  value: string | undefined;
  templates: EloCalculationTemplate[];
  onChange: (templateId: string) => void;
  disabled?: boolean;
}

/** Rating (ELO) template picker; "Pure Win/Loss" first and marked as the default. */
export function EloTemplateSelect({
  value,
  templates,
  onChange,
  disabled = false,
}: EloTemplateSelectProps) {
  const { t } = useTranslation();
  const selected = value || DEFAULT_ELO_TEMPLATE_ID;

  return (
    <Tooltip
      title={t('tournament.shuffleConfig.eloTemplateTooltip')}
      arrow
      placement="top"
      enterDelay={500}
    >
      <FormControl fullWidth data-testid="shuffle-elo-template-field" sx={{ maxWidth: 480 }}>
        <InputLabel id="elo-template-label" shrink>
          {t('tournament.shuffleConfig.eloTemplateLabel')}
        </InputLabel>
        <Select
          labelId="elo-template-label"
          value={templates.length > 0 ? selected : ''}
          label={t('tournament.shuffleConfig.eloTemplateLabel')}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          notched
        >
          {templates
            .filter((template) => template.enabled || template.id === DEFAULT_ELO_TEMPLATE_ID)
            .sort((a, b) => {
              if (a.id === DEFAULT_ELO_TEMPLATE_ID) return -1;
              if (b.id === DEFAULT_ELO_TEMPLATE_ID) return 1;
              return a.name.localeCompare(b.name);
            })
            .map((template) => (
              <MenuItem key={template.id} value={template.id}>
                {template.name}
                {template.id === DEFAULT_ELO_TEMPLATE_ID && (
                  <em style={{ marginLeft: 8, opacity: 0.7, fontSize: '0.875rem' }}>
                    {t('tournament.shuffleConfig.eloDefaultSuffix')}
                  </em>
                )}
              </MenuItem>
            ))}
        </Select>
        <FormHelperText>
          {templates.find((template) => template.id === selected)?.description ||
            t('tournament.shuffleConfig.eloTemplateHelper')}
        </FormHelperText>
      </FormControl>
    </Tooltip>
  );
}
