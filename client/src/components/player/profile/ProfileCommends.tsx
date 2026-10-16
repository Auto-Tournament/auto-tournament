import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { COMMEND_KINDS, commendColor, type CommendKind } from '../../match/CommendPanel';
import { SectionTitle, panel } from '../../tournament/ui/draftUi';
import { mono, radii, tokens } from '../../../theme/tokens';

interface Counts {
  total: number;
  matches: number;
  kinds: Record<CommendKind, number>;
  other: Array<{ tag: string; count: number }>;
}

/**
 * "Commended by other players" on a profile: a tile per kind with its count,
 * most first, then matchmaking's other tags. Counts only, never who gave
 * them. Nothing while the player has none.
 */
export function ProfileCommends({ playerId }: { playerId: string }) {
  const { t } = useTranslation();
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ success: boolean } & Counts>(`/api/commends/player/${encodeURIComponent(playerId)}`)
      .then((res) => !cancelled && setCounts(res))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  if (!counts || counts.total === 0) return null;

  const tiles = [
    ...COMMEND_KINDS.map((kind) => ({
      key: kind,
      name: t(`commends.kinds.${kind}`),
      note: t(`commends.kindNotes.${kind}`),
      count: counts.kinds[kind],
      dot: commendColor[kind],
    })),
    ...counts.other.map((o) => ({
      key: o.tag,
      name: t(`matchmaking.profile.tag.${o.tag}`, { defaultValue: o.tag }),
      note: t('commends.fromMatchmaking'),
      count: o.count,
      dot: tokens.color.info,
    })),
  ].sort((a, b) => b.count - a.count);

  return (
    <Box
      component="section"
      aria-labelledby="profile-commends"
      data-testid="profile-commends"
      sx={{ ...panel, mt: 4 }}
    >
      <SectionTitle
        id="profile-commends"
        title={t('commends.profileTitle')}
        note={`${t('commends.totalN', { count: counts.total })} · ${t('commends.matchesN', { count: counts.matches })}`}
      />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11rem), 1fr))',
          gap: 1.5,
        }}
      >
        {tiles.map((tile) => (
          <Box
            key={tile.key}
            data-testid={`profile-commend-${tile.key}`}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              p: 2,
              borderRadius: radii.md,
              bgcolor: tokens.color.paper3,
            }}
          >
            <Box
              component="span"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontWeight: 600 }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tile.dot }}
              />
              {tile.name}
            </Box>
            <Typography sx={{ ...mono, fontSize: '1.625rem', lineHeight: 1.1 }}>
              {tile.count}
            </Typography>
            <Typography sx={{ fontSize: '0.875rem', color: tokens.color.ink2 }}>
              {tile.note}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: '0.875rem', color: tokens.color.muted }}>
        {t('commends.profileFoot')}
      </Typography>
    </Box>
  );
}
