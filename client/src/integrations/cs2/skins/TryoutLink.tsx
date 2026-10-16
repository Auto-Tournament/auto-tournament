/**
 * "Try them in game": the skin tryout servers (Ready Up on the Skin tryout
 * plugin set) that are online, each with a join link and the console line.
 * Equipping here reaches the server at once, so a player can keep this page
 * open and swap skins while in game. Nothing shows while none is online.
 */
import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { GameControllerIcon } from '@phosphor-icons/react';
import {
  api,
  useModuleTranslation,
  tokens,
  radii,
  panelSx,
  panelBorderSx,
} from '../../../module-sdk';

const { color } = tokens;

interface TryoutServer {
  name: string;
  address: string;
  connectIp: string | null;
  port: number;
}

export function TryoutLink() {
  const { t } = useModuleTranslation('cs2');
  const [servers, setServers] = useState<TryoutServer[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ servers: TryoutServer[] }>('/api/skins/tryout')
      .then((r) => !cancelled && setServers(r.servers ?? []))
      .catch(() => !cancelled && setServers([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (servers.length === 0) return null;
  return (
    <Box
      component="section"
      aria-labelledby="tryout-title"
      data-testid="skins-tryout"
      sx={{
        ...panelSx,
        ...panelBorderSx,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 2,
        p: 2,
      }}
    >
      <GameControllerIcon size={28} color={color.accent} aria-hidden />
      <Box sx={{ flex: '1 1 16rem', minWidth: 0 }}>
        <Typography id="tryout-title" sx={{ fontWeight: 600 }}>
          {t('skins.tryout.title')}
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
          {t('skins.tryout.hint')}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {servers.map((s) => (
          <Box
            key={s.address}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
          >
            <Typography
              component="code"
              sx={{ fontSize: '0.8125rem', color: color.muted, userSelect: 'all' }}
              title={t('skins.tryout.console')}
            >
              connect {s.address}
            </Typography>
            <Button
              variant="contained"
              size="small"
              component="a"
              href={`steam://connect/${s.connectIp ?? s.address.split(':')[0]}:${s.port}`}
              data-testid="skins-tryout-join"
              aria-label={t('skins.tryout.joinLabel', { name: s.name })}
              sx={{ borderRadius: radii.pill }}
            >
              {t('skins.tryout.join')}
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
