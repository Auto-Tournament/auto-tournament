import { useEffect, useMemo, useState } from 'react';
import { Box, Button, InputBase, MenuItem, Select, Typography } from '@mui/material';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import {
  api,
  useModuleTranslation,
  tokens,
  radii,
  withAlpha,
  SegmentedControl,
  fmtMoney,
} from '../../../module-sdk';
import { rarityColor, RARITY_ORDER } from './rarity';
import { SKIN_CATEGORIES, skinCategory, type SkinCategory } from './categories';
import { formatOdds } from './formatOdds';

const { color } = tokens;
const PAGE = 48;

interface CatalogSkin {
  weapon: string;
  weaponName: string;
  name: string;
  variant: string | null;
  paintKit: number;
  rarity: string;
  slot: string;
  image: string;
  /** Knives and gloves: the market price (USD) that set their rarity. */
  price: number | null;
  /** Percent chance of this exact skin per drop option. */
  chance: number;
}

type Sort = 'rarity' | 'chance' | 'name';

/**
 * Every skin a drop can give (GET /api/skins/catalog), on the drop rates
 * page: search, filter by weapon group and rarity, sort; each skin with its
 * rarity and its chance per drop option.
 */
export function SkinCatalog() {
  const { t, i18n } = useModuleTranslation('cs2');
  const locale = !i18n.language || i18n.language === 'en' ? 'en-GB' : i18n.language;
  const [skins, setSkins] = useState<CatalogSkin[] | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<'all' | SkinCategory>('all');
  const [rarities, setRarities] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('rarity');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let live = true;
    api
      .get<{ skins: CatalogSkin[] }>('/api/skins/catalog')
      .then((res) => live && setSkins(res.skins ?? []))
      .catch(() => live && setSkins([]));
    return () => {
      live = false;
    };
  }, []);

  const rarityRank = (r: string) => RARITY_ORDER.indexOf(r);
  const list = useMemo(() => {
    if (!skins) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = skins.filter((s) => {
      if (group !== 'all' && skinCategory(s) !== group) return false;
      if (rarities.length > 0 && !rarities.includes(s.rarity)) return false;
      const text = `${s.weaponName} ${s.name} ${s.variant ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const byName = (a: CatalogSkin, b: CatalogSkin) =>
      `${a.weaponName} ${a.name}`.localeCompare(`${b.weaponName} ${b.name}`, locale);
    return out.sort((a, b) =>
      sort === 'name'
        ? byName(a, b)
        : sort === 'chance'
          ? b.chance - a.chance || byName(a, b)
          : rarityRank(b.rarity) - rarityRank(a.rarity) || byName(a, b)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skins, query, group, rarities, sort, locale]);

  // A new filter starts from the top again.
  const resetPage = () => setShown(PAGE);
  const present = RARITY_ORDER.filter((r) => skins?.some((s) => s.rarity === r)).reverse();

  return (
    <Box
      component="section"
      aria-labelledby="drops-catalog"
      sx={{ display: 'grid', gap: 1.5 }}
      data-testid="skin-catalog"
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Typography
          id="drops-catalog"
          component="h2"
          sx={{ fontWeight: 600, fontSize: '1.125rem' }}
        >
          {t('skins.catalog.title')}
        </Typography>
        {skins && (
          <Typography sx={{ fontSize: '0.875rem', color: color.muted }} aria-live="polite">
            {t('skins.catalog.count', { count: list.length })}
          </Typography>
        )}
      </Box>
      <Typography sx={{ fontSize: '0.875rem', color: color.ink2, maxWidth: '65ch' }}>
        {t('skins.catalog.intro')}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            minHeight: 40,
            flex: '1 1 240px',
            borderRadius: radii.pill,
            border: `1px solid ${color.rule}`,
            bgcolor: color.paper2,
            color: color.muted,
          }}
        >
          <MagnifyingGlassIcon size={18} aria-hidden />
          <InputBase
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetPage();
            }}
            placeholder={t('skins.catalog.search')}
            inputProps={{
              'aria-label': t('skins.catalog.search'),
              'data-testid': 'skin-catalog-search',
            }}
            sx={{ flex: 1, minWidth: 0, color: color.ink }}
          />
        </Box>
        <Select
          size="small"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          inputProps={{ 'aria-label': t('skins.catalog.sortLabel') }}
          sx={{ borderRadius: radii.pill, minWidth: 170 }}
        >
          <MenuItem value="rarity">{t('skins.catalog.sort.rarity')}</MenuItem>
          <MenuItem value="chance">{t('skins.catalog.sort.chance')}</MenuItem>
          <MenuItem value="name">{t('skins.catalog.sort.name')}</MenuItem>
        </Select>
      </Box>
      <SegmentedControl<'all' | SkinCategory>
        look="chips"
        size="small"
        label={t('skins.catalog.groupLabel')}
        value={group}
        onChange={(v) => {
          setGroup(v);
          resetPage();
        }}
        options={(['all', ...SKIN_CATEGORIES] as Array<'all' | SkinCategory>).map((g) => ({
          value: g,
          label: t(`skins.filter.${g}`),
        }))}
      />
      <SegmentedControl
        multiple
        look="chips"
        size="small"
        label={t('skins.catalog.rarityLabel')}
        value={rarities}
        onChange={(v) => {
          setRarities(v);
          resetPage();
        }}
        options={present.map((r) => ({
          value: r,
          label: (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              <Box
                component="span"
                aria-hidden
                sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: rarityColor[r] }}
              />
              {t(`skins.rarity.${r}`)}
            </Box>
          ),
        }))}
      />

      {!skins ? (
        <Typography sx={{ color: color.muted }}>{t('skins.catalog.loading')}</Typography>
      ) : list.length === 0 ? (
        <Typography sx={{ color: color.muted }}>{t('skins.catalog.none')}</Typography>
      ) : (
        <Box
          component="ul"
          sx={{
            listStyle: 'none',
            m: 0,
            p: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 170px), 1fr))',
            gap: 1,
          }}
        >
          {list.slice(0, shown).map((s) => {
            const tone = rarityColor[s.rarity] ?? color.rule;
            return (
              <Box
                component="li"
                key={`${s.weapon}-${s.paintKit}`}
                data-testid="skin-catalog-item"
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  p: 1.25,
                  borderRadius: radii.md,
                  bgcolor: withAlpha(tone, 0.06),
                  borderBottom: `3px solid ${tone}`,
                  minWidth: 0,
                }}
              >
                <Box
                  component="img"
                  src={s.image}
                  alt=""
                  loading="lazy"
                  sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'contain' }}
                />
                <Typography sx={{ fontSize: '0.75rem', color: color.muted, lineHeight: 1.3 }}>
                  {s.weaponName}
                </Typography>
                <Typography
                  sx={{
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    lineHeight: 1.3,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {s.name}
                  {s.variant ? ` · ${s.variant}` : ''}
                </Typography>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 1,
                    mt: 'auto',
                    pt: 0.5,
                  }}
                >
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: tone }}>
                    {t(`skins.rarity.${s.rarity}`)}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: '0.75rem',
                      color: color.ink2,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                    title={t('skins.catalog.chanceHelp')}
                  >
                    {formatOdds(s.chance, locale)}
                  </Typography>
                </Box>
                {s.price !== null && (
                  <Typography sx={{ fontSize: '0.6875rem', color: color.muted }}>
                    {t('skins.catalog.price', { price: fmtMoney(s.price) })}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      {skins && list.length > shown && (
        <Button
          variant="outlined"
          onClick={() => setShown((n) => n + PAGE * 2)}
          sx={{ justifySelf: 'center', borderRadius: radii.pill, px: 3 }}
          data-testid="skin-catalog-more"
        >
          {t('skins.catalog.more', { count: list.length - shown })}
        </Button>
      )}
    </Box>
  );
}
