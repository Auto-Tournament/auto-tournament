/**
 * The inputs for a tournament's custom stat fields (3.0 phase D, PR D8).
 *
 * Rendered inside the captain's report form and inside an admin's ruling on a
 * dispute, because `POST .../report` and `POST .../resolve` take the same
 * `stats` list and measure it against the same fields.
 *
 * One block per field, and inside it one input per subject: two inputs for a
 * per-team field (one per side), one per membership for a per-player field.
 * Per side rather than one long list, because a captain fills in their own
 * team's numbers and reads the opponent's off the scoreboard, and a flat list
 * of ten names with no team headings is the form nobody fills in correctly.
 */

import { Box, Stack, TextField, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../module-sdk';
import type { CustomStatField, MatchReportView } from '../api';
import { MAX_TEXT, cellKey, sidesOf, subjectsFor, type StatDraft } from './statFields';

interface StatFieldsFormProps {
  view: MatchReportView;
  fields: CustomStatField[];
  draft: StatDraft;
  onChange: (cell: string, value: string) => void;
  disabled?: boolean;
  /** Prefix for the `data-testid` of every input, so two forms never collide. */
  testIdPrefix: string;
}

export function StatFieldsForm({
  view,
  fields,
  draft,
  onChange,
  disabled,
  testIdPrefix,
}: StatFieldsFormProps) {
  const { t } = useModuleTranslation('manual-report');
  const unknownTeam = t('manualReport.unknownTeam');
  const sides = sidesOf(view);

  if (fields.length === 0) return null;

  return (
    <Stack spacing={2} data-testid={`${testIdPrefix}-stats`}>
      <Typography variant="body2" color="text.secondary">
        {t('manualReport.stats.hint')}
      </Typography>

      {fields.map((field) => (
        <Box key={field.key} data-testid={`${testIdPrefix}-stat-field-${field.key}`}>
          <Typography variant="subtitle2" fontWeight={600}>
            {field.label}
            {field.required && (
              <Typography component="span" variant="caption" color="text.secondary" ml={1}>
                {t('manualReport.stats.required')}
              </Typography>
            )}
          </Typography>

          <Stack spacing={1.5} mt={1}>
            {sides.map((side) => {
              const subjects = subjectsFor(view, field, side, unknownTeam);
              if (subjects.length === 0) return null;
              return (
                <Box key={side}>
                  {field.scope === 'player' && (
                    <Typography variant="caption" color="text.secondary">
                      {view.match[side].name || unknownTeam}
                    </Typography>
                  )}
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    flexWrap="wrap"
                    useFlexGap
                    mt={field.scope === 'player' ? 0.5 : 0}
                  >
                    {subjects.map((subject) => {
                      const cell = cellKey(field.key, subject.id);
                      return (
                        <TextField
                          key={cell}
                          size="small"
                          disabled={disabled}
                          type={field.valueType === 'text' ? 'text' : 'number'}
                          label={subject.label}
                          value={draft[cell] ?? ''}
                          sx={{ minWidth: { sm: 160 }, flex: { sm: '1 1 160px' } }}
                          inputProps={{
                            ...(field.valueType === 'text'
                              ? { maxLength: MAX_TEXT }
                              : { step: field.valueType === 'integer' ? 1 : 'any' }),
                            'data-testid': `${testIdPrefix}-stat-${field.key}-${subject.id}`,
                          }}
                          onChange={(event) => onChange(cell, event.target.value)}
                        />
                      );
                    })}
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
