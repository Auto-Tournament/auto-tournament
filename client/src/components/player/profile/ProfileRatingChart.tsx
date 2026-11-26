import { useMemo, useRef, useState, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { matchPagePath } from '../../../paths';
import { mono, textSize, tokens } from '../../../theme/tokens';
import { mapLabel, type ProfileMatch } from './profileMatch';

export interface ProfileRatingChartProps {
  /** Rated matches, oldest first (the last N the chart plots). */
  matches: ProfileMatch[];
}

const HEIGHT = 230;
/** The plot keeps 2% clear at each side, so the first and last points are not cut. */
const PAD = 2;

/**
 * The Overview's rating chart: the rating after each match as a line, a row
 * of results above it (a filled dot a win, a ring a loss). Pointing anywhere
 * over it opens the card of the match whose column is nearest; a click keeps
 * that card open (a second click lets go), and the card links to the match.
 * Keyboard: every point is a button, focus opens its card.
 */
export function ProfileRatingChart({ matches }: ProfileRatingChartProps) {
  const { t, i18n } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const n = matches.length;
  const geometry = useMemo(() => {
    const elos = matches.map((m) => m.eloAfter ?? 0);
    const lo = Math.min(...elos) - 40;
    const hi = Math.max(...elos) + 40;
    const x = (i: number) => (n <= 1 ? 50 : PAD + (i / (n - 1)) * (100 - 2 * PAD));
    const y = (e: number) => (hi === lo ? 50 : 100 - ((e - lo) / (hi - lo)) * 100);
    const pts = matches.map((m, i) => `${x(i)},${y(m.eloAfter ?? 0)}`).join(' ');
    return { x, y, line: pts, area: `${x(0)},100 ${pts} ${x(n - 1)},100` };
  }, [matches, n]);

  if (n === 0) return null;

  const nearest = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - box.left) / box.width) * 100;
    if (n <= 1) return 0;
    return Math.max(0, Math.min(n - 1, Math.round(((pct - PAD) / (100 - 2 * PAD)) * (n - 1))));
  };

  const shown = hover ?? pinned;
  const date = (at: number) =>
    new Date(at * 1000).toLocaleDateString(i18n.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  const resultLabel = (m: ProfileMatch) =>
    t(m.won ? 'playerPage.chart.winLabel' : 'playerPage.chart.lossLabel', {
      title: m.title,
      date: date(m.at),
      rating: m.eloAfter,
    });

  const card = shown !== null ? matches[shown] : null;
  const cardX = shown !== null ? geometry.x(shown) : 0;

  return (
    <Box
      sx={{ position: 'relative', fontVariantNumeric: 'tabular-nums' }}
      data-testid="profile-rating-chart"
    >
      {/* Anywhere over the chart: the nearest match. */}
      <Box
        ref={areaRef}
        aria-hidden
        onMouseMove={(e) => {
          const i = nearest(e);
          if (i !== hover) setHover(i);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const i = nearest(e);
          setPinned((p) => (p === i ? null : i));
          setHover(i);
        }}
        sx={{ position: 'absolute', inset: '-8px 0 -28px 0', zIndex: 2, cursor: 'crosshair' }}
      />

      <Box
        role="list"
        aria-label={t('playerPage.chart.resultsLabel')}
        sx={{ position: 'relative', height: 18 }}
      >
        {matches.map((m, i) => (
          <Box
            key={m.key}
            role="listitem"
            aria-label={resultLabel(m)}
            sx={{
              position: 'absolute',
              top: 4,
              left: `${geometry.x(i)}%`,
              width: 10,
              height: 10,
              ml: '-5px',
              borderRadius: '50%',
              boxSizing: 'border-box',
              ...(m.won
                ? { bgcolor: tokens.color.live }
                : { border: `2px solid ${tokens.color.ban}` }),
              outline: i === shown ? `2px solid ${tokens.color.ink}` : 'none',
              outlineOffset: 2,
            }}
          />
        ))}
      </Box>

      <Box
        sx={{
          position: 'relative',
          height: HEIGHT,
          mt: 1.25,
          borderBottom: `1px solid ${tokens.color.rule}`,
          backgroundImage: `linear-gradient(${tokens.color.rule} 1px, transparent 1px)`,
          backgroundSize: `100% ${HEIGHT / 3}px`,
        }}
      >
        <Box
          component="svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
          }}
        >
          <polygon points={geometry.area} fill={tokens.color.accent} fillOpacity={0.12} />
          <polyline
            points={geometry.line}
            fill="none"
            stroke={tokens.color.accent}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {shown !== null && (
            <line
              x1={cardX}
              x2={cardX}
              y1={0}
              y2={100}
              stroke={tokens.color.ink}
              strokeOpacity={0.35}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </Box>
        {matches.map((m, i) => {
          const on = i === shown;
          return (
            <Box
              key={m.key}
              component="button"
              type="button"
              aria-label={resultLabel(m)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => setPinned((p) => (p === i ? null : i))}
              sx={{
                position: 'absolute',
                left: `${geometry.x(i)}%`,
                top: `${geometry.y(m.eloAfter ?? 0)}%`,
                width: on ? 16 : 10,
                height: on ? 16 : 10,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                p: 0,
                border: `2px solid ${tokens.color.paper}`,
                bgcolor: on ? tokens.color.ink : tokens.color.accent,
                boxShadow: on
                  ? `0 0 0 4px color-mix(in oklab, ${tokens.color.accent} 35%, transparent)`
                  : 'none',
                cursor: 'pointer',
                '&:focus-visible': { outline: `2px solid ${tokens.color.focus}`, outlineOffset: 2 },
              }}
            />
          );
        })}

        {card && (
          <Box
            role="status"
            data-testid="profile-rating-chart-card"
            sx={{
              position: 'absolute',
              top: 6,
              ...(cardX > 55
                ? { right: `calc(${100 - cardX}% + 18px)` }
                : { left: `calc(${cardX}% + 18px)` }),
              width: 240,
              p: 2,
              borderRadius: '14px',
              bgcolor: tokens.color.paper3,
              border: `1px solid ${tokens.color.rule}`,
              boxShadow: `0 12px 32px ${tokens.color.shadow}`,
              zIndex: 3,
              // Only a kept card takes the mouse (its link); a passing one lets it through.
              pointerEvents: shown === pinned ? 'auto' : 'none',
            }}
          >
            <Typography
              sx={{
                ...mono,
                fontSize: textSize.xs,
                color: 'text.secondary',
                textTransform: 'uppercase',
              }}
            >
              {date(card.at)}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, minWidth: 0 }}>
              <Box
                sx={{
                  flex: 'none',
                  width: 22,
                  height: 22,
                  borderRadius: '6px',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                  fontSize: textSize.xs,
                  boxSizing: 'border-box',
                  ...(card.won
                    ? { bgcolor: tokens.color.live, color: tokens.color.paper }
                    : { border: `2px solid ${tokens.color.ban}`, color: tokens.color.ban }),
                }}
              >
                {card.won ? t('playerPage.win') : t('playerPage.loss')}
              </Box>
              {card.score && (
                <Typography sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {card.score[0]} : {card.score[1]}
                </Typography>
              )}
              <Typography
                noWrap
                sx={{ color: 'text.secondary', fontSize: textSize.sm, minWidth: 0 }}
              >
                {card.maps.length > 0 ? mapLabel(card.maps) : card.title}
              </Typography>
            </Box>
            <Typography noWrap sx={{ fontSize: textSize.sm, mt: 0.5 }}>
              {card.title}
            </Typography>
            <Box
              component="dl"
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '6px 16px',
                m: 0,
                mt: 1.5,
                fontSize: textSize.sm,
                '& dt': { color: 'text.secondary' },
                '& dd': { m: 0, textAlign: 'right' },
              }}
            >
              {typeof card.kills === 'number' && typeof card.deaths === 'number' && (
                <>
                  <dt>{t('playerPage.chart.kda')}</dt>
                  <dd>
                    {card.kills} / {card.deaths} / {card.assists ?? 0}
                  </dd>
                </>
              )}
              {typeof card.adr === 'number' && (
                <>
                  <dt>{t('playerPage.stats.adr')}</dt>
                  <dd>{Math.round(card.adr)}</dd>
                </>
              )}
              <dt>{t('playerPage.ratingChart.sectionTitle')}</dt>
              <dd>
                {card.eloAfter}{' '}
                {typeof card.eloChange === 'number' && card.eloChange !== 0 && (
                  <Box
                    component="span"
                    sx={{
                      fontWeight: 600,
                      color: card.eloChange > 0 ? tokens.color.live : tokens.color.ban,
                    }}
                  >
                    {card.eloChange > 0 ? '+' : ''}
                    {card.eloChange}
                  </Box>
                )}
              </dd>
            </Box>
            {card.slug && (
              <Box
                component={RouterLink}
                to={matchPagePath(card.slug)}
                sx={{
                  display: 'inline-block',
                  mt: 1.5,
                  fontSize: textSize.sm,
                  fontWeight: 500,
                  color: tokens.color.accent,
                }}
              >
                {t('playerPage.chart.openMatch')}
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          mt: 1,
          ...mono,
          fontSize: textSize.xs,
          color: 'text.secondary',
        }}
      >
        <span>{date(matches[0].at)}</span>
        <span>{date(matches[n - 1].at)}</span>
      </Box>
    </Box>
  );
}
