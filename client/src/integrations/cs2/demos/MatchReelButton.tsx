import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import { FilmStripIcon } from '@phosphor-icons/react';
import { api, useModuleTranslation } from '../../../module-sdk';
import type { MatchMapActionProps } from '../../types';
import { watchMatchReelPath, watchTeamReelPath } from '../highlights/data';
import { RecordingDot } from '../../../module-sdk';

interface TeamReel {
  teamId: string;
  team: string | null;
  video: string | null;
}

interface MatchReel {
  mapNumber: number;
  status: string;
  clips: number | null;
  video: string | null;
}

/**
 * Beside a map's demo download (`matchMapAction`): "Match reel" once the
 * recorder joined each player's best highlight of the map. It opens the
 * reel's own page, a link to share, with our player and its chapters.
 * Nothing until then. Beside the match's first map, its team reels too
 * (each team's best plays of the whole match).
 */
export function MatchReelButton({ matchSlug, mapNumber, onNavigate }: MatchMapActionProps) {
  const { t } = useModuleTranslation('cs2');
  const [reel, setReel] = useState<MatchReel | null>(null);
  const [teams, setTeams] = useState<TeamReel[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ reels: MatchReel[]; teams?: TeamReel[] }>(
        `/api/game/cs2/matches/${encodeURIComponent(matchSlug)}/reels`
      )
      .then((res) => {
        if (cancelled) return;
        setReel(res.reels.find((r) => r.mapNumber === mapNumber) ?? null);
        const first = res.reels.length ? Math.min(...res.reels.map((r) => r.mapNumber)) : mapNumber;
        setTeams(mapNumber === first ? (res.teams ?? []).filter((t) => t.video) : []);
      })
      .catch(() => !cancelled && setReel(null));
    return () => {
      cancelled = true;
    };
  }, [matchSlug, mapNumber]);

  // Still being made: say so where the button will be.
  if (reel && !reel.video && (reel.status === 'recording' || reel.status === 'pending')) {
    return (
      <Box
        role="status"
        data-testid={`match-reel-recording-${mapNumber}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          height: 36,
          borderRadius: 999,
          border: '1px dashed',
          borderColor: 'divider',
          color: 'text.secondary',
          fontSize: '0.8125rem',
          whiteSpace: 'nowrap',
          flex: 'none',
        }}
      >
        <RecordingDot />
        {t('highlights.matchReelRecording')}
      </Box>
    );
  }
  const teamButtons = teams.map((tr) => (
    <Button
      key={tr.teamId}
      component={RouterLink}
      to={watchTeamReelPath(matchSlug, tr.teamId)}
      onClick={onNavigate}
      variant="outlined"
      startIcon={<FilmStripIcon />}
      data-testid={`team-reel-button-${tr.teamId}`}
      sx={{ flex: 'none', whiteSpace: 'nowrap' }}
    >
      {t('highlights.teamReelButton', { team: tr.team ?? '' })}
    </Button>
  ));
  if (!reel?.video) return teamButtons.length ? <>{teamButtons}</> : null;
  return (
    <>
      <Button
        component={RouterLink}
        to={watchMatchReelPath(matchSlug, mapNumber)}
        onClick={onNavigate}
        variant="outlined"
        startIcon={<FilmStripIcon />}
        data-testid={`match-reel-button-${mapNumber}`}
        sx={{ flex: 'none', whiteSpace: 'nowrap' }}
      >
        {t('highlights.matchReel')}
      </Button>
      {teamButtons}
    </>
  );
}
