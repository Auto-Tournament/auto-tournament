import { useCallback, useEffect, useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { api, fontDisplay, mono, radii, textSize, tokens, useModuleTranslation } from '../../../../module-sdk';
import type { FleetHost, Server } from '../../cs2.types';
import ServerModal from '../ServerModal';

const { color } = tokens;

/**
 * Servers no machine reports: added by address before servers came only
 * through csm, or a Ready Up server that enrolled on its own. They keep
 * working; each opens its settings, where it can be removed. Nothing here
 * adds one: new servers are made on a machine.
 */
export function OtherServers({ hosts }: { hosts: FleetHost[] }) {
  const { t } = useModuleTranslation('cs2');
  const [servers, setServers] = useState<Server[] | null>(null);
  const [editing, setEditing] = useState<Server | null>(null);
  // When the list was read, to tell which servers reported lately.
  const [readAt, setReadAt] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; servers?: Server[] }>('/api/servers');
      setServers(res.servers ?? []);
      setReadAt(Date.now() / 1000);
    } catch {
      setServers([]);
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const onMachines = new Set(hosts.flatMap((h) => h.servers.map((s) => s.fleetServer?.id).filter((id): id is string => !!id)));
  const others = (servers ?? []).filter((s) => !onMachines.has(s.id));
  if (others.length === 0) return null;

  // Up when it reported in the last two minutes (the list carries no live status).
  const up = (s: Server) => s.status === 'online' || (!!s.lastSeen && readAt - s.lastSeen < 120);
  const tone = (s: Server) => (!s.enabled ? color.muted : up(s) ? color.live : color.ban);
  const word = (s: Server) =>
    !s.enabled
      ? t('serversBoard.other.disabled', { defaultValue: 'Disabled' })
      : up(s)
        ? s.currentMatch
          ? t('serversBoard.state.match', { defaultValue: 'Match' })
          : t('serversBoard.state.free', { defaultValue: 'Free' })
        : t('serversBoard.state.offline', { defaultValue: 'Down' });

  return (
    <Box component="section" aria-labelledby="other-servers" data-testid="servers-other" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box>
        <Typography id="other-servers" component="h2" sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: textSize.lg }}>
          {t('serversBoard.other.title', { defaultValue: 'Servers not on a machine' })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('serversBoard.other.about', {
            defaultValue: 'Added by address, or enrolled on their own. They keep working; new servers are made on a machine.',
          })}
        </Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 14rem), 1fr))', gap: 1.25 }}>
        {others.map((s) => (
          <ButtonBase
            key={s.id}
            onClick={() => setEditing(s)}
            data-testid={`server-card-${s.name.replace(/\s+/g, '-').toLowerCase()}`}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              textAlign: 'left',
              gap: 0.5,
              p: 1.5,
              borderRadius: radii.md,
              bgcolor: color.paper2,
              border: `1px solid ${color.rule}`,
              '&:hover': { borderColor: color.muted },
              '&.Mui-focusVisible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Box component="span" sx={{ fontWeight: 600, fontSize: textSize.sm, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </Box>
              <Box component="span" sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: '0.75rem', color: color.ink2, whiteSpace: 'nowrap' }}>
                <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: radii.pill, bgcolor: tone(s) }} />
                {word(s)}
              </Box>
            </Box>
            <Box component="span" data-testid="server-host" sx={{ ...mono, fontSize: '0.75rem', color: color.muted }}>
              {s.host}:{s.port}
            </Box>
          </ButtonBase>
        ))}
      </Box>
      <ServerModal
        open={editing !== null}
        server={editing}
        servers={servers ?? []}
        onClose={() => setEditing(null)}
        onSave={() => void load()}
      />
    </Box>
  );
}
