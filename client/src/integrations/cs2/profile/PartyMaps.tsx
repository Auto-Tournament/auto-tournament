import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { api, textSize, tokens, useModuleTranslation } from '../../../module-sdk';
import type { PartyViewProps } from '../../types';
import { MapRadar, type MapResult } from './MapRadar';

interface PartyMapsResponse {
  success: boolean;
  maps: MapResult[];
  activeDuty: string[];
}

/**
 * The `partyView` slot: the party's map strength on /play, the team page's
 * radar over every member's matches added up, with the Active Duty maps in
 * colour. Renders nothing until the party has three maps on record.
 */
export function PartyMaps({ members }: PartyViewProps) {
  const { t } = useModuleTranslation('cs2');
  const key = [...members].sort().join(',');
  const [loaded, setLoaded] = useState<{ key: string; data: PartyMapsResponse } | null>(null);

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    api
      .get<PartyMapsResponse>(`/api/game/cs2/party-maps?players=${encodeURIComponent(key)}`)
      .then((res) => {
        if (!cancelled && res.success) setLoaded({ key, data: res });
      })
      .catch(() => {
        // The party panel still shows.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const data = loaded?.key === key ? loaded.data : null;
  if (!data || data.maps.filter((m) => m.played > 0).length < 3) return null;

  return (
    <Box data-testid="cs2-party-maps" sx={{ width: '100%', display: 'grid', gap: 1 }}>
      <Typography sx={{ fontSize: textSize.sm, fontWeight: 600, color: tokens.color.ink2 }}>
        {t('profile.partyMaps')}
      </Typography>
      <Box sx={{ maxWidth: 340, width: '100%', mx: 'auto' }}>
        <MapRadar
          maps={data.maps}
          label={t('profile.partyMapsAria')}
          highlight={new Set(data.activeDuty)}
        />
      </Box>
      <Typography sx={{ fontSize: textSize.sm, color: tokens.color.muted, textAlign: 'center' }}>
        {t('profile.partyMapsNote')}
      </Typography>
    </Box>
  );
}
