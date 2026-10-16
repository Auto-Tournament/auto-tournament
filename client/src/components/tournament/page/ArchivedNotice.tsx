/**
 * An archived tournament's pages say so (the drafts' empty states, "Archived
 * tournament"): a newer one replaced it, its results stay here, and a link to
 * the one that is current now.
 */
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { paths, tournamentTabPath } from '../../../paths';
import { tokens } from '../../../theme/tokens';
import { h2Sx, panel } from '../ui/draftUi';

interface Listed {
  id: number;
  status: string;
  archived?: boolean;
  draft?: boolean;
}

const ORDER = ['in_progress', 'ready', 'setup', 'completed'];

export function ArchivedNotice({ tournamentId }: { tournamentId: number }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ tournaments?: Listed[] }>('/api/tournaments')
      .then((r) => {
        if (cancelled) return;
        const open = (r.tournaments ?? [])
          .filter((x) => x.id !== tournamentId && !x.archived && !x.draft)
          .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.id - a.id);
        setCurrent(open[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  return (
    <Box
      component="section"
      role="status"
      data-testid="tournament-archived"
      sx={{ ...panel, alignItems: 'flex-start', mb: 3 }}
    >
      <Typography component="h2" sx={h2Sx}>
        {t('overviewPage.archivedTitle')}
      </Typography>
      <Typography component="span" sx={{ color: tokens.color.ink2 }}>
        {t('overviewPage.archivedBody')}
      </Typography>
      <Button
        component={RouterLink}
        to={current ? tournamentTabPath(current) : paths.tournamentList}
        variant="outlined"
        size="small"
      >
        {current ? t('overviewPage.openCurrent') : t('overviewPage.allTournaments')}
      </Button>
    </Box>
  );
}
