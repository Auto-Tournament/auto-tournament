import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { fontDisplay, textSize, tokens } from '../../../theme/tokens';
import { prettyMap, type ProfileMatch } from './profileMatch';

interface Best {
  key: string;
  value: string;
  label: string;
  context: string;
}

/**
 * "At their best": the player's standout numbers, each with where it came
 * from, all read from their own matches (never a made-up figure). A number
 * the matches do not have is left out; with none, the section is not shown.
 */
export function ProfileBest({ matches }: { matches: ProfileMatch[] }) {
  const { t, i18n } = useTranslation();
  const day = (at: number) =>
    new Date(at * 1000).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const where = (m: ProfileMatch) =>
    [
      m.score ? `${m.score[0]}–${m.score[1]}` : null,
      m.maps[0] ? prettyMap(m.maps[0]) : null,
      day(m.at),
    ]
      .filter(Boolean)
      .join(' · ');

  const best: Best[] = [];

  const withAdr = matches.filter((m) => typeof m.adr === 'number' && (m.adr as number) > 0);
  if (withAdr.length > 0) {
    const top = withAdr.reduce((a, b) => ((b.adr as number) > (a.adr as number) ? b : a));
    best.push({
      key: 'adr',
      value: String(Math.round(top.adr as number)),
      label: t('playerPage.best.adr'),
      context: where(top),
    });
  }

  const withKills = matches.filter((m) => typeof m.kills === 'number' && (m.kills as number) > 0);
  if (withKills.length > 0) {
    const top = withKills.reduce((a, b) => ((b.kills as number) > (a.kills as number) ? b : a));
    best.push({
      key: 'kills',
      value: String(top.kills),
      label: t('playerPage.best.kills'),
      context: where(top),
    });
  }

  const kills = withKills.reduce((s, m) => s + (m.kills as number), 0);
  const heads = withKills.reduce((s, m) => s + (m.headshots ?? 0), 0);
  if (kills >= 20 && heads > 0) {
    best.push({
      key: 'hs',
      value: `${Math.round((heads / kills) * 100)}%`,
      label: t('playerPage.best.headshots'),
      context: t('playerPage.best.headshotsContext', { heads, kills }),
    });
  }

  // The map won most often, from two played up.
  const byMap = new Map<string, { played: number; won: number }>();
  for (const m of matches) {
    if (m.maps.length !== 1) continue;
    const s = byMap.get(m.maps[0]) ?? { played: 0, won: 0 };
    s.played += 1;
    if (m.won) s.won += 1;
    byMap.set(m.maps[0], s);
  }
  const maps = [...byMap.entries()].filter(([, s]) => s.played >= 2);
  if (maps.length > 0) {
    const [map, s] = maps.reduce((a, b) =>
      b[1].won / b[1].played > a[1].won / a[1].played ||
      (b[1].won / b[1].played === a[1].won / a[1].played && b[1].played > a[1].played)
        ? b
        : a
    );
    if (s.won > 0)
      best.push({
        key: 'map',
        value: prettyMap(map),
        label: t('playerPage.best.map'),
        context: t('playerPage.best.mapContext', { won: s.won, played: s.played }),
      });
  }

  if (best.length === 0) return null;

  return (
    <Box
      component="section"
      aria-labelledby="profile-best"
      data-testid="profile-best"
      sx={{ mt: 8 }}
    >
      <Typography id="profile-best" component="h2" variant="h6" sx={{ fontWeight: 600 }}>
        {t('playerPage.best.title')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          mt: 2.5,
          borderTop: `1px solid ${tokens.color.rule}`,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {best.map((b, i) => (
          <Box
            key={b.key}
            data-testid={`profile-best-${b.key}`}
            sx={{
              pt: 2.5,
              pr: 2.5,
              pl: i === 0 ? 0 : 2.5,
              borderLeft: i === 0 ? 'none' : `1px solid ${tokens.color.rule}`,
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                fontFamily: fontDisplay,
                fontWeight: 700,
                fontSize: '2.5rem',
                lineHeight: 1,
                letterSpacing: '-0.02em',
                overflowWrap: 'anywhere',
              }}
            >
              {b.value}
            </Box>
            <Typography sx={{ fontWeight: 500, mt: 1.25 }}>{b.label}</Typography>
            <Typography sx={{ fontSize: textSize.sm, color: 'text.secondary', mt: 0.5 }}>
              {b.context}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
