/**
 * Manage's Prizes tab for one CS2 tournament (the 3.0 draft's Prizes board):
 * a skin per place and how it is given (pick 1 of 3, or one at random),
 * whether its matches drop skins, and an MVP prize chosen by commends, rating
 * or the organizer. After the final, the organizer's MVP pick is here too.
 * Everything is `settings.cs2` (rewards, matchDrops, mvp); site skins only.
 */
import { useEffect, useMemo, useState } from 'react';
import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import {
  api,
  apiErrorMessage,
  useModuleTranslation,
  useSnackbar,
  tokens,
  radii,
  mono,
  fontDisplay,
  panelSx,
  SwitchRow,
  FormField,
} from '../../../module-sdk';
import type { TournamentPrizesManageProps } from '../../types';
import { rarityColor } from './rarity';

const { color } = tokens;

/** Places with a prize: 1st–4th, and 0 for everyone else who played. */
const PLACES = [1, 2, 3, 4, 0] as const;
const RARITIES = ['ancient', 'legendary', 'mythical', 'rare', 'uncommon', 'common'] as const;
const PLACE_COLOR: Record<number, string> = {
  1: color.medalGold,
  2: color.medalSilver,
  3: color.medalBronze,
  4: color.muted,
  0: color.muted,
};

type Pick = 'choice' | 'one';
interface PlacePrize {
  place: number;
  /** A rarity, or 'none'. */
  rarity: string;
  pick: Pick;
}
interface Mvp {
  enabled: boolean;
  by: 'commends' | 'rating' | 'admin';
  rarity: string;
  pick: Pick;
}
interface StoredReward {
  place: number;
  mode: string;
  rarity?: string | null;
  pick?: 'one';
}
interface Candidate {
  steamId: string;
  name: string;
  teamName: string | null;
  commends: number;
  commendedBy: number;
  rating: number | null;
}

function cs2Of(settings: unknown): Record<string, unknown> {
  const cs2 = (settings as { cs2?: unknown } | null | undefined)?.cs2;
  return cs2 && typeof cs2 === 'object' ? (cs2 as Record<string, unknown>) : {};
}

function toPlaces(rewards: StoredReward[]): PlacePrize[] {
  return PLACES.map((place) => {
    const r = rewards.find((x) => x.place === place);
    return {
      place,
      rarity: !r || r.mode === 'none' || !r.rarity ? 'none' : r.rarity,
      pick: r?.pick === 'one' ? 'one' : 'choice',
    };
  });
}

export function PrizesManage({ tournament, onSave }: TournamentPrizesManageProps) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const cs2 = cs2Of(tournament.settings);
  const [siteRewards, setSiteRewards] = useState<StoredReward[] | null>(null);
  const [places, setPlaces] = useState<PlacePrize[] | null>(null);
  const [matchDrops, setMatchDrops] = useState(cs2.matchDrops !== false);
  const storedMvp = (cs2.mvp ?? null) as Partial<Mvp> | null;
  const [mvp, setMvp] = useState<Mvp>({
    enabled: storedMvp?.enabled === true,
    by: storedMvp?.by ?? 'commends',
    rarity: storedMvp?.rarity ?? 'legendary',
    pick: storedMvp?.pick === 'one' ? 'one' : 'choice',
  });
  const [saving, setSaving] = useState(false);
  const rewardsOff = cs2.skinRewards === false || cs2.esportsMode === true;

  useEffect(() => {
    let live = true;
    api
      .get<{ config: { rewards: StoredReward[] } }>('/api/skins/admin/config')
      .then((res) => live && setSiteRewards(res.config.rewards ?? []))
      .catch(() => live && setSiteRewards([]));
    return () => {
      live = false;
    };
  }, []);

  // The tournament's own prizes, else the site's, as the starting point.
  useEffect(() => {
    if (places || siteRewards === null) return;
    const own = Array.isArray(cs2.rewards) ? (cs2.rewards as StoredReward[]) : null;
    setPlaces(toPlaces(own ?? siteRewards));
  }, [places, siteRewards, cs2.rewards]);

  const setPlace = (place: number, patch: Partial<PlacePrize>) =>
    setPlaces((prev) => prev?.map((p) => (p.place === place ? { ...p, ...patch } : p)) ?? prev);

  const save = async () => {
    if (!places) return;
    setSaving(true);
    try {
      await onSave({
        cs2: {
          ...cs2,
          rewards: places.map((p) =>
            p.rarity === 'none'
              ? { place: p.place, mode: 'none' }
              : {
                  place: p.place,
                  mode: 'random',
                  rarity: p.rarity,
                  ...(p.pick === 'one' ? { pick: 'one' } : {}),
                }
          ),
          matchDrops,
          mvp: {
            enabled: mvp.enabled,
            by: mvp.by,
            rarity: mvp.rarity,
            ...(mvp.pick === 'one' ? { pick: 'one' } : {}),
          },
        },
      });
      showSuccess(t('skins.prizesManage.saved'));
    } catch (error) {
      showError(apiErrorMessage(error, t('skins.prizesManage.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const placeLabel = (place: number) =>
    place === 0
      ? t('skins.prizesManage.everyone')
      : t('skins.prizesManage.placeN', { count: place, ordinal: true });
  const rarityOptions = (withNone: boolean) => [
    ...RARITIES.map((r) => (
      <MenuItem key={r} value={r}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="span"
            aria-hidden
            sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: rarityColor[r] }}
          />
          {t(`skins.rarity.${r}`)}
        </Box>
      </MenuItem>
    )),
    ...(withNone
      ? [
          <MenuItem key="none" value="none">
            {t('skins.prizesManage.nothing')}
          </MenuItem>,
        ]
      : []),
  ];
  const pickOptions = [
    <MenuItem key="choice" value="choice">
      {t('skins.prizesManage.pickChoice')}
    </MenuItem>,
    <MenuItem key="one" value="one">
      {t('skins.prizesManage.pickOne')}
    </MenuItem>,
  ];

  const panel = {
    borderRadius: radii.lg,
    bgcolor: color.paper2,
    p: { xs: 2, sm: 3 },
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  } as const;
  const h2 = { m: 0, fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 700 } as const;

  return (
    <Box data-testid="prizes-manage" sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {rewardsOff && (
        <Typography data-testid="prizes-off" sx={{ ...panel, color: color.warning }}>
          {t('skins.prizesManage.off')}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
        <Box
          component="section"
          aria-labelledby="prizes-places"
          sx={{ ...panel, flex: '999 1 520px' }}
        >
          <Typography id="prizes-places" component="h2" sx={h2}>
            {t('skins.prizesManage.byPlace')}
          </Typography>
          <Box
            component="ol"
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            {(places ?? []).map((p) => (
              <Box
                key={p.place}
                component="li"
                data-testid={`prize-place-${p.place}`}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'minmax(0, 1fr)',
                    sm: '96px minmax(0, 1fr) minmax(0, 1fr)',
                  },
                  gap: 1.5,
                  alignItems: 'center',
                  px: 2,
                  py: 1.5,
                  borderRadius: radii.md,
                  bgcolor: color.paper3,
                }}
              >
                <Typography
                  sx={{
                    ...mono,
                    fontSize: p.place === 0 ? '0.875rem' : '1.125rem',
                    color: PLACE_COLOR[p.place],
                  }}
                >
                  {placeLabel(p.place)}
                </Typography>
                <FormField
                  layout="side"
                  label={t('skins.prizesManage.skin')}
                  htmlFor={`prize-${p.place}-skin`}
                  labelWidth={56}
                >
                  <TextField
                    select
                    size="small"
                    id={`prize-${p.place}-skin`}
                    value={p.rarity}
                    onChange={(e) => setPlace(p.place, { rarity: e.target.value })}
                    slotProps={{ htmlInput: { 'data-testid': `prize-${p.place}-skin` } }}
                  >
                    {rarityOptions(true)}
                  </TextField>
                </FormField>
                <FormField
                  layout="side"
                  label={t('skins.prizesManage.how')}
                  htmlFor={`prize-${p.place}-how`}
                  labelWidth={56}
                >
                  <TextField
                    select
                    size="small"
                    id={`prize-${p.place}-how`}
                    value={p.pick}
                    disabled={p.rarity === 'none'}
                    onChange={(e) => setPlace(p.place, { pick: e.target.value as Pick })}
                    slotProps={{ htmlInput: { 'data-testid': `prize-${p.place}-how` } }}
                  >
                    {pickOptions}
                  </TextField>
                </FormField>
              </Box>
            ))}
          </Box>

          <SwitchRow
            label={t('skins.prizesManage.matchDrops')}
            checked={matchDrops}
            onChange={(_e, v) => setMatchDrops(v)}
            slotProps={{ input: { 'data-testid': 'prizes-match-drops' } as Record<string, string> }}
          />
          <SwitchRow
            label={t('skins.prizesManage.mvpToggle')}
            checked={mvp.enabled}
            onChange={(_e, enabled) => setMvp({ ...mvp, enabled })}
            slotProps={{ input: { 'data-testid': 'prizes-mvp' } as Record<string, string> }}
          />
          {mvp.enabled && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
                gap: 1.5,
                pl: { sm: 2 },
              }}
            >
              <FormField
                layout="side"
                label={t('skins.prizesManage.chosenBy')}
                htmlFor="prize-mvp-by"
                labelWidth={80}
              >
                <TextField
                  select
                  size="small"
                  id="prize-mvp-by"
                  value={mvp.by}
                  onChange={(e) => setMvp({ ...mvp, by: e.target.value as Mvp['by'] })}
                  slotProps={{ htmlInput: { 'data-testid': 'prize-mvp-by' } }}
                >
                  <MenuItem value="commends">{t('skins.prizesManage.byCommends')}</MenuItem>
                  <MenuItem value="rating">{t('skins.prizesManage.byRating')}</MenuItem>
                  <MenuItem value="admin">{t('skins.prizesManage.byAdmin')}</MenuItem>
                </TextField>
              </FormField>
              <FormField
                layout="side"
                label={t('skins.prizesManage.skin')}
                htmlFor="prize-mvp-skin"
                labelWidth={80}
              >
                <TextField
                  select
                  size="small"
                  id="prize-mvp-skin"
                  value={mvp.rarity}
                  onChange={(e) => setMvp({ ...mvp, rarity: e.target.value })}
                >
                  {rarityOptions(false)}
                </TextField>
              </FormField>
              <FormField
                layout="side"
                label={t('skins.prizesManage.how')}
                htmlFor="prize-mvp-how"
                labelWidth={80}
              >
                <TextField
                  select
                  size="small"
                  id="prize-mvp-how"
                  value={mvp.pick}
                  onChange={(e) => setMvp({ ...mvp, pick: e.target.value as Pick })}
                >
                  {pickOptions}
                </TextField>
              </FormField>
            </Box>
          )}
          <Button
            variant="contained"
            onClick={() => void save()}
            disabled={saving || !places}
            data-testid="prizes-save"
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('skins.prizesManage.save')}
          </Button>
        </Box>

        <Box component="aside" aria-labelledby="prizes-where" sx={{ ...panel, flex: '1 1 260px' }}>
          <Typography id="prizes-where" component="h2" sx={h2}>
            {t('skins.prizesManage.whereTitle')}
          </Typography>
          <Box
            component="ul"
            sx={{
              m: 0,
              pl: 2.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              fontSize: '0.875rem',
              color: color.ink2,
            }}
          >
            {(['rules', 'out', 'champions', 'inventory'] as const).map((key) => (
              <li key={key}>
                <Box component="span" sx={{ color: color.ink, fontWeight: 600 }}>
                  {t(`skins.prizesManage.where.${key}Label`)}
                </Box>{' '}
                {t(`skins.prizesManage.where.${key}`)}
              </li>
            ))}
          </Box>
        </Box>
      </Box>

      {tournament.status === 'completed' && mvp.enabled && storedMvp?.enabled && (
        <MvpPick tournamentId={tournament.id} />
      )}
    </Box>
  );
}

/**
 * After the final: who is (or could be) the MVP. The organizer picks when
 * the MVP is theirs to choose; the ranking is the hint either way.
 */
function MvpPick({ tournamentId }: { tournamentId: number }) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [data, setData] = useState<{
    by: string;
    given: { steamId: string; name: string } | null;
    candidates: Candidate[];
  } | null>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .get<{
        by: string;
        given: { steamId: string; name: string } | null;
        candidates: Candidate[];
      }>(`/api/skins/tournaments/${tournamentId}/mvp-candidates`)
      .then((res) => live && setData(res))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [tournamentId, version]);

  const mostCommended = useMemo(
    () => (data ? [...data.candidates].sort((a, b) => b.commends - a.commends)[0] : undefined),
    [data]
  );
  const bestRating = useMemo(
    () =>
      data
        ? [...data.candidates]
            .filter((c) => c.rating !== null)
            .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0]
        : undefined,
    [data]
  );
  if (!data) return null;

  const give = async () => {
    setBusy(true);
    try {
      await api.post(`/api/skins/tournaments/${tournamentId}/mvp`, { steamId: picked });
      showSuccess(t('skins.prizesManage.mvpGiven'));
      setVersion((v) => v + 1);
    } catch (error) {
      showError(apiErrorMessage(error, t('skins.prizesManage.mvpFailed')));
    } finally {
      setBusy(false);
    }
  };

  const describe = (c: Candidate) =>
    [
      c.teamName,
      t('skins.prizesManage.commendsN', { count: c.commends }),
      c.rating !== null ? t('skins.prizesManage.ratingN', { rating: c.rating.toFixed(2) }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Box
      component="section"
      aria-labelledby="prizes-mvp-pick"
      data-testid="prizes-mvp-pick"
      sx={{
        ...panelSx,
        p: { xs: 2, sm: 3 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        border: `2px solid ${color.medalGold}`,
      }}
    >
      <Typography
        id="prizes-mvp-pick"
        component="h2"
        sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 700 }}
      >
        {t('skins.prizesManage.mvpTitle')}
      </Typography>
      {data.given ? (
        <Typography data-testid="prizes-mvp-given">
          {t('skins.prizesManage.mvpIs', { name: data.given.name })}
        </Typography>
      ) : data.by === 'admin' ? (
        <>
          <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
            {[
              mostCommended && mostCommended.commends > 0
                ? t('skins.prizesManage.hintCommends', {
                    name: mostCommended.name,
                    count: mostCommended.commends,
                  })
                : null,
              bestRating
                ? t('skins.prizesManage.hintRating', {
                    name: bestRating.name,
                    rating: bestRating.rating?.toFixed(2),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || t('skins.prizesManage.hintNone')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
            <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
              <FormField
                layout="side"
                label={t('skins.prizesManage.player')}
                htmlFor="prize-mvp-player"
                labelWidth={64}
              >
                <TextField
                  select
                  size="small"
                  id="prize-mvp-player"
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                  slotProps={{ htmlInput: { 'data-testid': 'prize-mvp-player' } }}
                >
                  {data.candidates.map((c) => (
                    <MenuItem key={c.steamId} value={c.steamId}>
                      {c.name}
                      <Box
                        component="span"
                        sx={{ ml: 1, color: color.muted, fontSize: '0.8125rem' }}
                      >
                        {describe(c)}
                      </Box>
                    </MenuItem>
                  ))}
                </TextField>
              </FormField>
            </Box>
            <Button
              variant="contained"
              disabled={!picked || busy}
              onClick={() => void give()}
              data-testid="prize-mvp-give"
            >
              {t('skins.prizesManage.giveMvp')}
            </Button>
          </Box>
        </>
      ) : (
        <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
          {t('skins.prizesManage.mvpNobody')}
        </Typography>
      )}
    </Box>
  );
}
