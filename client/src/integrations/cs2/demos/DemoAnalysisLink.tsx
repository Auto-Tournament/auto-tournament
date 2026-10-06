import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Button } from '@mui/material';
import { ChartBarIcon } from '@phosphor-icons/react';
import { api, useModuleTranslation } from '../../../module-sdk';
import type { MatchMapActionProps } from '../../types';
import { analysisPath } from './paths';

/**
 * Beside a map's demo download (`matchMapAction`): "Analysis" once the
 * worker read the demo, "Analyzing" while it is queued, nothing without one.
 */
export function DemoAnalysisLink({ matchSlug, mapNumber, onNavigate }: MatchMapActionProps) {
  const { t } = useModuleTranslation('cs2');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ status: string }>(
        `/api/game/cs2/matches/${encodeURIComponent(matchSlug)}/maps/${mapNumber}/analysis`
      )
      .then((res) => !cancelled && setStatus(res.status))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, [matchSlug, mapNumber]);

  if (status === 'done') {
    return (
      <Button
        component={RouterLink}
        to={analysisPath(matchSlug, mapNumber)}
        onClick={onNavigate}
        variant="outlined"
        startIcon={<ChartBarIcon />}
        data-testid={`demo-analysis-link-${mapNumber}`}
        sx={{ flex: 'none', whiteSpace: 'nowrap' }}
      >
        {t('analysis.open')}
      </Button>
    );
  }
  if (status === 'pending' || status === 'running') {
    return (
      <Button variant="outlined" disabled sx={{ flex: 'none', whiteSpace: 'nowrap' }}>
        {t('analysis.analyzing')}
      </Button>
    );
  }
  return null;
}
