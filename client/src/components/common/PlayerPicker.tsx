import { useEffect, useState } from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { api } from '../../utils/api';
import { tokens } from '../../theme/tokens';
import { PlayerAvatar } from '../player/PlayerAvatar';

const { color } = tokens;

export interface PickedPlayer {
  steamid64: string;
  name: string;
}

interface Found {
  steamid64: string;
  name: string;
  avatar?: string | null;
  /** A SteamID64 typed in for someone the site does not know yet. */
  typed?: boolean;
}

const STEAM64 = /^7656119\d{10}$/;

/**
 * Pick a player by name: the site's players, searched as you type. Someone
 * who has never signed in can still be added by pasting their SteamID64.
 */
export function PlayerPicker({
  label,
  value,
  onChange,
  exclude = [],
  testId,
  autoFocus,
}: {
  label: string;
  value: PickedPlayer | null;
  onChange: (player: PickedPlayer | null) => void;
  /** SteamID64s not to offer (already on the roster). */
  exclude?: string[];
  testId?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .get<{ players?: Array<{ id: string; name: string; avatar?: string | null }> }>(
          `/api/players/find?query=${encodeURIComponent(q)}`
        )
        .then((r) => {
          if (!live) return;
          const list: Found[] = (r.players ?? []).map((p) => ({
            steamid64: p.id,
            name: p.name,
            avatar: p.avatar,
          }));
          if (STEAM64.test(q) && !list.some((p) => p.steamid64 === q)) {
            list.push({ steamid64: q, name: q, typed: true });
          }
          setFound(list);
        })
        .catch(
          () => live && setFound(STEAM64.test(q) ? [{ steamid64: q, name: q, typed: true }] : [])
        )
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Under two letters there is nothing to show, whatever the last search found.
  const options =
    query.trim().length < 2 ? [] : found.filter((p) => !exclude.includes(p.steamid64));
  return (
    <Autocomplete
      size="small"
      options={options}
      loading={loading}
      value={value ? { ...value } : null}
      onChange={(_, v) => onChange(v ? { steamid64: v.steamid64, name: v.name } : null)}
      inputValue={query}
      onInputChange={(_, v) => setQuery(v)}
      filterOptions={(o) => o}
      isOptionEqualToValue={(a, b) => a.steamid64 === b.steamid64}
      getOptionLabel={(o) => o.name}
      noOptionsText={
        query.trim().length < 2 ? 'Type at least two letters of the name' : 'No player found'
      }
      renderOption={(props, o) => (
        <Box component="li" {...props} key={o.steamid64} sx={{ display: 'flex', gap: 1.25 }}>
          <PlayerAvatar name={o.name} avatarUrl={o.avatar} size={24} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.9375rem' }}>
              {o.typed ? 'Not signed up yet: add by SteamID64' : o.name}
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
              {o.steamid64}
            </Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          autoFocus={autoFocus}
          inputProps={{ ...params.inputProps, ...(testId ? { 'data-testid': testId } : {}) }}
        />
      )}
      sx={{ minWidth: 240 }}
    />
  );
}
