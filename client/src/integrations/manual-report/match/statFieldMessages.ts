/**
 * The words `validateDraft` puts on a bad cell (3.0 phase D, PR D8).
 *
 * Kept out of `./statFields` so the checks themselves stay plain functions
 * with no React and no i18n in them, and out of the two forms so a captain and
 * an admin are told the same thing about the same mistake.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_TEXT } from './statFields';

export function useStatDraftLabels() {
  const { t } = useTranslation();
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
