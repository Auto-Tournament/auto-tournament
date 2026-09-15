import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

/** Cap on backend warnings listed in one toast. */
const WARNINGS_SHOWN = 5;

interface ImportWarningsMessageProps {
  warnings: string[];
}

/**
 * Body for a single warning toast that lists the non-fatal warnings an import
 * returned (e.g. a Discord ID that was dropped), instead of one toast each.
 */
export const ImportWarningsMessage: React.FC<ImportWarningsMessageProps> = ({ warnings }) => {
  const { t } = useTranslation();
  const shown = warnings.slice(0, WARNINGS_SHOWN);
  const hidden = warnings.length - shown.length;
  return (
    <Box>
      <Typography variant="body2" fontWeight={600}>
        {t('importWarnings.title', { count: warnings.length })}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2 }}>
        {shown.map((warning) => (
          <Typography component="li" variant="caption" key={warning}>
            {warning}
          </Typography>
        ))}
      </Box>
      {hidden > 0 && (
        <Typography variant="caption">{t('importWarnings.more', { count: hidden })}</Typography>
      )}
    </Box>
  );
};
