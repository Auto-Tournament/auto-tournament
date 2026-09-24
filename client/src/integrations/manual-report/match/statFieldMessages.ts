/**
 * The words `validateDraft` puts on a bad cell (3.0 phase D, PR D8).
 *
 * Kept out of `./statFields` so the checks themselves stay plain functions
 * with no React and no i18n in them, and out of the two forms so a captain and
 * an admin are told the same thing about the same mistake.
 */

import { useMemo } from 'react';
import { useModuleTranslation } from '../../../module-sdk';
import { MAX_TEXT } from './statFields';

export function useStatDraftLabels() {
  const { t } = useModuleTranslation('manual-report');
  return useMemo(
    () => ({
      unknownTeam: t('manualReport.unknownTeam'),
      problem: (
        problem: 'number' | 'integer' | 'range' | 'tooLong',
        field: { label: string },
        subject: { label: string }
      ) =>
        t(`manualReport.stats.errors.${problem}`, {
          field: field.label,
          subject: subject.label,
          max: MAX_TEXT,
        }),
      missing: (field: { label: string }, teamName: string) =>
        t('manualReport.stats.errors.missing', { field: field.label, team: teamName }),
    }),
    [t]
  );
}
