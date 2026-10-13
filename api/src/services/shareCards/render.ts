/**
 * Draws a share card (./types.ts) as a 1200×630 PNG: satori lays the card
 * out as SVG (text as paths, with the site's fonts), resvg's WebAssembly
 * build rasterises it. Pure JavaScript and wasm, so it runs from the bundle
 * in the release image, which has no node_modules: the fonts and the wasm are
 * copied next to the bundle (esbuild.config.js, dist/og-assets) and read from
 * node_modules when running from source.
 *
 * Looks follow the "Share card (OG image)" canvas: the site's dark paper and
 * orange accent, Sora for display, Geist for text; with no picture, an
 * orange tile with initials.
 */

import fs from 'fs';
import path from 'path';
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import type { CardData, CardImage, CardStat, CardTeam } from './types';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const C = {
  paper: '#100908',
  paper2: '#18110e',
  paper3: '#211815',
  rule: '#322926',
  field: '#736966',
  ink: '#f4edeb',
  ink2: '#c4bcb9',
  muted: '#938a87',
  accent: '#ff6a3d',
  accentInk: '#140e0c',
  live: '#3fc168',
};
const DISPLAY = 'Sora';
const TEXT = 'Geist';

// ---------------------------------------------------------------------------
// Assets: fonts and the rasteriser
// ---------------------------------------------------------------------------

const ASSETS: Record<string, string> = {
  'sora-700.woff': '@fontsource/sora/files/sora-latin-700-normal.woff',
  'sora-600.woff': '@fontsource/sora/files/sora-latin-600-normal.woff',
  'geist-400.woff': '@fontsource/geist/files/geist-latin-400-normal.woff',
  'geist-600.woff': '@fontsource/geist/files/geist-latin-600-normal.woff',
  'resvg.wasm': '@resvg/resvg-wasm/index_bg.wasm',
  // The ram, from the web client's public files (not a package).
  'logo.png': 'client/public/icon-192.png',
};

/** An asset's bytes: next to the bundle (dist/og-assets), else from node_modules. */
function readAsset(name: string): Buffer {
  const beside = path.join(__dirname, 'og-assets', name);
  if (fs.existsSync(beside)) return fs.readFileSync(beside);
  const source = ASSETS[name];
  if (source.startsWith('client/'))
    return fs.readFileSync(path.resolve(__dirname, '../../../..', source));
  return fs.readFileSync(require.resolve(source));
}

/** The files esbuild.config.js copies to dist/og-assets: name → package path. */
export const SHARE_CARD_ASSETS = ASSETS;

let ready: Promise<{ fonts: Parameters<typeof satori>[1]['fonts']; logo: CardImage }> | null = null;
/** The ram, once set up (brand(site) draws it). */
let logo: CardImage | null = null;

function setup() {
  if (!ready) {
    ready = (async () => {
      await initWasm(readAsset('resvg.wasm'));
      logo = { data: readAsset('logo.png'), type: 'image/png' };
      return {
        logo,
        fonts: [
          {
            name: DISPLAY,
            data: readAsset('sora-700.woff'),
            weight: 700 as const,
            style: 'normal' as const,
          },
          {
            name: DISPLAY,
            data: readAsset('sora-600.woff'),
            weight: 600 as const,
            style: 'normal' as const,
          },
          {
            name: TEXT,
            data: readAsset('geist-400.woff'),
            weight: 400 as const,
            style: 'normal' as const,
          },
          {
            name: TEXT,
            data: readAsset('geist-600.woff'),
            weight: 600 as const,
            style: 'normal' as const,
          },
        ],
      };
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

// ---------------------------------------------------------------------------
// A tiny element builder (satori takes React-shaped objects)
// ---------------------------------------------------------------------------

type Style = Record<string, string | number>;
type Child = El | string | null | false | undefined;
interface El {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
  key?: null;
}

function h(type: string, style: Style, ...children: Child[]): El {
  const kids = children.filter(
    (c): c is El | string => c !== null && c !== false && c !== undefined
  );
  return {
    type,
    props: {
      style: type === 'img' ? style : { display: 'flex', ...style },
      children: kids.length === 1 ? kids[0] : kids,
    },
  };
}

function img(src: CardImage, style: Style): El {
  return {
    type: 'img',
    props: {
      src: `data:${src.type};base64,${src.data.toString('base64')}`,
      style: { objectFit: 'cover', ...style },
    },
  };
}

/** "Team Alpha" → "TA"; one word → its first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** A picture, or the orange initials tile in its place (`outlined`: the second team's). */
function picture(
  image: CardImage | null,
  name: string,
  size: number,
  radius: number | string,
  outlined = false
): El {
  if (image) return img(image, { width: size, height: size, borderRadius: radius });
  return h(
    'div',
    {
      width: size,
      height: size,
      borderRadius: radius,
      alignItems: 'center',
      justifyContent: 'center',
      background: outlined ? C.rule : C.accent,
      border: outlined ? `2px solid ${C.accent}` : 'none',
      color: outlined ? C.accent : C.accentInk,
      fontFamily: DISPLAY,
      fontWeight: 700,
      fontSize: Math.round(size * 0.44),
    },
    radius === '50%' ? initials(name).slice(0, 1) : initials(name)
  );
}

const brand = (site: string) =>
  h(
    'div',
    { alignItems: 'center', gap: 10 },
    logo
      ? img(logo, { width: 40, height: 40, borderRadius: 10 })
      : h('div', { width: 40, height: 40, borderRadius: 10, background: C.accent }),
    h(
      'div',
      {
        fontFamily: DISPLAY,
        fontWeight: 600,
        fontSize: 22,
        color: C.ink,
        maxWidth: 360,
        ...ellipsis,
      },
      site
    )
  );

const glow = (style: Style) =>
  h('div', {
    position: 'absolute',
    width: 640,
    height: 640,
    borderRadius: 320,
    backgroundImage: 'radial-gradient(circle, rgba(255,106,61,0.22), rgba(255,106,61,0) 70%)',
    ...style,
  });

const kicker = (text: string) =>
  h(
    'div',
    {
      fontSize: 24,
      color: C.accent,
      fontWeight: 600,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    text
  );

const statBox = (s: CardStat, big = 44) =>
  h(
    'div',
    {
      flex: 1,
      flexDirection: 'column',
      gap: 6,
      padding: 22,
      borderRadius: 18,
      background: C.paper2,
      border: `1px solid ${C.rule}`,
    },
    h('div', { fontSize: 18, color: C.muted }, s.label),
    h('div', { fontFamily: DISPLAY, fontWeight: 700, fontSize: big, color: C.ink }, s.value)
  );

const frame = (...children: Child[]) =>
  h(
    'div',
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      position: 'relative',
      overflow: 'hidden',
      background: C.paper,
      color: C.ink,
      fontFamily: TEXT,
    },
    ...children
  );

/** A display size that keeps a long name to two lines. */
const titleSize = (text: string, max: number) =>
  text.length <= 18 ? max : text.length <= 30 ? Math.round(max * 0.8) : Math.round(max * 0.64);

const ellipsis: Style = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

function clipCard(c: Extract<CardData, { kind: 'clip' }>, site: string): El {
  return frame(
    c.thumbnail
      ? img(c.thumbnail, {
          position: 'absolute',
          left: 0,
          top: 0,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
        })
      : h('div', {
          position: 'absolute',
          left: 0,
          top: 0,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          background: C.paper3,
        }),
    h('div', {
      position: 'absolute',
      left: 0,
      bottom: 0,
      width: CARD_WIDTH,
      height: 320,
      backgroundImage: 'linear-gradient(to top, rgba(16,9,8,0.96), rgba(16,9,8,0))',
    }),
    h(
      'div',
      {
        position: 'absolute',
        left: 544,
        top: 209,
        width: 112,
        height: 112,
        borderRadius: 56,
        background: 'rgba(16,9,8,0.55)',
        border: `3px solid ${C.ink}`,
        alignItems: 'center',
        justifyContent: 'center',
      },
      h('div', {
        width: 0,
        height: 0,
        marginLeft: 8,
        borderTop: '22px solid transparent',
        borderBottom: '22px solid transparent',
        borderLeft: `36px solid ${C.ink}`,
      })
    ),
    h(
      'div',
      {
        position: 'absolute',
        left: 64,
        right: 64,
        bottom: 56,
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 32,
      },
      h(
        'div',
        { flexDirection: 'column', gap: 12, maxWidth: 820 },
        h(
          'div',
          { alignItems: 'center', gap: 12 },
          h(
            'div',
            {
              padding: '6px 16px',
              borderRadius: 999,
              background: C.accent,
              color: C.accentInk,
              fontWeight: 600,
              fontSize: 22,
            },
            c.tag
          ),
          h('div', { fontSize: 22, color: C.ink2 }, c.detail)
        ),
        h(
          'div',
          { fontFamily: DISPLAY, fontWeight: 700, fontSize: 64, lineHeight: 1.05, ...ellipsis },
          c.player
        ),
        h('div', { fontSize: 24, color: C.ink2, ...ellipsis }, c.context)
      ),
      brand(site)
    )
  );
}

function teamColumn(t: CardTeam, outlined: boolean): El {
  return h(
    'div',
    { flex: 1, flexDirection: 'column', alignItems: 'center', gap: 18 },
    picture(t.logo, t.name, 168, 32, outlined),
    h(
      'div',
      { fontFamily: DISPLAY, fontWeight: 700, fontSize: 40, maxWidth: 380, ...ellipsis },
      t.name
    )
  );
}

function matchCard(c: Extract<CardData, { kind: 'match' }>, site: string): El {
  const tone = c.status.tone === 'live' ? C.accent : c.status.tone === 'done' ? C.live : C.accent;
  const middle = c.score
    ? h(
        'div',
        {
          alignItems: 'center',
          gap: 24,
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 120,
          lineHeight: 1,
        },
        h('div', { color: c.score[0] >= c.score[1] ? C.accent : C.ink2 }, String(c.score[0])),
        h('div', { color: C.field, fontSize: 64 }, '–'),
        h('div', { color: c.score[1] > c.score[0] ? C.accent : C.ink2 }, String(c.score[1]))
      )
    : h('div', { fontFamily: DISPLAY, fontWeight: 700, fontSize: 72, color: C.field }, 'vs');
  return frame(
    h(
      'div',
      {
        position: 'absolute',
        left: 0,
        top: 0,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        padding: '56px 64px',
        flexDirection: 'column',
        justifyContent: 'space-between',
      },
      h(
        'div',
        { justifyContent: 'space-between', alignItems: 'center', gap: 24 },
        h('div', { fontSize: 24, color: C.ink2, maxWidth: 880, ...ellipsis }, c.header),
        h(
          'div',
          {
            padding: '6px 16px',
            borderRadius: 999,
            border: `2px solid ${tone}`,
            color: tone,
            fontWeight: 600,
            fontSize: 20,
          },
          c.status.label
        )
      ),
      h(
        'div',
        { alignItems: 'center', gap: 40 },
        teamColumn(c.team1, false),
        middle,
        teamColumn(c.team2, true)
      ),
      h(
        'div',
        { justifyContent: 'space-between', alignItems: 'center', gap: 24 },
        c.chips.length > 0
          ? h(
              'div',
              { gap: 12, fontSize: 22, color: C.ink2, maxWidth: 820, overflow: 'hidden' },
              ...c.chips
                .slice(0, 5)
                .map((chip) =>
                  h('div', { padding: '6px 14px', borderRadius: 10, background: C.paper3 }, chip)
                )
            )
          : h('div', { fontSize: 22, color: C.ink2 }, c.footer ?? ''),
        brand(site)
      )
    )
  );
}

function teamCard(c: Extract<CardData, { kind: 'team' }>, site: string): El {
  const avatars = c.members.slice(0, 5);
  return frame(
    glow({ right: -120, top: -120 }),
    h(
      'div',
      {
        position: 'absolute',
        left: 64,
        top: 0,
        width: CARD_WIDTH - 128,
        height: CARD_HEIGHT,
        alignItems: 'center',
        gap: 56,
      },
      picture(c.logo, c.name, 300, 56),
      h(
        'div',
        { flexDirection: 'column', gap: 22, maxWidth: 680 },
        kicker(c.label),
        h(
          'div',
          { fontFamily: DISPLAY, fontWeight: 700, fontSize: 80, lineHeight: 1, ...ellipsis },
          c.name
        ),
        c.stats.length > 0
          ? h(
              'div',
              { gap: 28, fontSize: 26, color: C.ink2 },
              ...c.stats.map((s) =>
                h('div', { gap: 8 }, h('div', { color: C.ink, fontWeight: 600 }, s.value), s.label)
              )
            )
          : h('div', { fontSize: 26, color: C.ink2 }, c.note ?? ''),
        avatars.length > 0 &&
          h(
            'div',
            { alignItems: 'center', gap: 14 },
            h(
              'div',
              {},
              ...avatars.map((m, i) =>
                h(
                  'div',
                  {
                    marginLeft: i === 0 ? 0 : -14,
                    border: `3px solid ${C.paper}`,
                    borderRadius: 999,
                  },
                  m.avatar
                    ? img(m.avatar, { width: 52, height: 52, borderRadius: 999 })
                    : h(
                        'div',
                        {
                          width: 52,
                          height: 52,
                          borderRadius: 999,
                          background: i % 2 ? C.rule : '#3a2e2a',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 600,
                          fontSize: 20,
                        },
                        initials(m.name).slice(0, 1)
                      )
                )
              )
            ),
            h(
              'div',
              { fontSize: 22, color: C.muted },
              `${c.memberCount} player${c.memberCount === 1 ? '' : 's'}`
            )
          )
      )
    ),
    h('div', { position: 'absolute', right: 64, bottom: 56 }, brand(site))
  );
}

function playerCard(c: Extract<CardData, { kind: 'player' }>, site: string): El {
  const change =
    c.ratingChange !== 0
      ? h(
          'div',
          { color: c.ratingChange > 0 ? C.live : C.accent, marginLeft: 8 },
          `${c.ratingChange > 0 ? '+' : ''}${c.ratingChange}`
        )
      : null;
  return frame(
    glow({ right: -140, top: -160 }),
    h(
      'div',
      {
        position: 'absolute',
        left: 0,
        top: 0,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        padding: 64,
        flexDirection: 'column',
        justifyContent: 'space-between',
      },
      h(
        'div',
        { justifyContent: 'space-between', alignItems: 'flex-start', gap: 40 },
        h(
          'div',
          { alignItems: 'center', gap: 28, maxWidth: 720 },
          picture(c.avatar, c.name, 160, '50%'),
          h(
            'div',
            { flexDirection: 'column', gap: 10, maxWidth: 520 },
            h(
              'div',
              { fontFamily: DISPLAY, fontWeight: 700, fontSize: 76, lineHeight: 1, ...ellipsis },
              c.name
            ),
            h('div', { fontSize: 26, color: C.ink2, ...ellipsis }, c.sub)
          )
        ),
        c.rating !== null &&
          h(
            'div',
            { flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
            h(
              'div',
              {
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 120,
                lineHeight: 0.9,
                color: C.accent,
              },
              String(c.rating)
            ),
            h(
              'div',
              { fontSize: 22, color: C.ink2, textTransform: 'uppercase', letterSpacing: 2 },
              'Rating',
              change,
              change ? h('div', { marginLeft: 8 }, 'this month') : null
            )
          )
      ),
      c.stats.length > 0
        ? h('div', { gap: 16 }, ...c.stats.slice(0, 4).map((s) => statBox(s)))
        : h('div', {}),
      h(
        'div',
        { justifyContent: 'space-between', alignItems: 'center' },
        h('div', { fontSize: 22, color: C.muted }, c.footer ?? ''),
        brand(site)
      )
    )
  );
}

function tournamentCard(c: Extract<CardData, { kind: 'tournament' }>, site: string): El {
  return frame(
    c.banner
      ? img(c.banner, {
          position: 'absolute',
          left: 0,
          top: 0,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
        })
      : glow({ right: -180, top: -200, width: 760, height: 760, borderRadius: 380 }),
    c.banner
      ? h('div', {
          position: 'absolute',
          left: 0,
          top: 0,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          backgroundImage: 'linear-gradient(90deg, rgba(16,9,8,1) 38%, rgba(16,9,8,0.55))',
        })
      : null,
    h(
      'div',
      {
        position: 'absolute',
        left: 0,
        top: 0,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        padding: 64,
        flexDirection: 'column',
        justifyContent: 'space-between',
      },
      h(
        'div',
        { flexDirection: 'column', gap: 20, maxWidth: 820 },
        kicker(c.label),
        h(
          'div',
          {
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: titleSize(c.name, 84),
            lineHeight: 1.04,
            maxHeight: titleSize(c.name, 84) * 2.1,
            overflow: 'hidden',
          },
          c.name
        ),
        h('div', { fontSize: 26, color: C.ink2 }, c.sub)
      ),
      h(
        'div',
        { justifyContent: 'space-between', alignItems: 'flex-end', gap: 32 },
        c.champion
          ? h(
              'div',
              {
                alignItems: 'center',
                gap: 18,
                padding: '16px 22px 16px 16px',
                borderRadius: 20,
                background: 'rgba(24,17,14,0.92)',
                border: `1px solid ${C.rule}`,
              },
              picture(c.champion.logo, c.champion.name, 72, 16),
              h(
                'div',
                { flexDirection: 'column', gap: 4 },
                h('div', { fontSize: 18, color: C.muted }, 'Champion'),
                h('div', { fontFamily: DISPLAY, fontWeight: 700, fontSize: 32 }, c.champion.name)
              )
            )
          : c.badge
            ? h(
                'div',
                {
                  padding: '12px 22px',
                  borderRadius: 999,
                  background: C.accent,
                  color: C.accentInk,
                  fontWeight: 600,
                  fontSize: 24,
                },
                c.badge
              )
            : h('div', {}),
        brand(site)
      )
    )
  );
}

function reelCard(c: Extract<CardData, { kind: 'reel' }>, site: string): El {
  const thumbs = c.thumbnails.slice(0, 3);
  return frame(
    h(
      'div',
      {
        position: 'absolute',
        left: 0,
        top: 0,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        padding: '48px 64px 56px',
        flexDirection: 'column',
        gap: 32,
      },
      h(
        'div',
        { gap: 14, height: 300 },
        ...(thumbs.length > 0
          ? thumbs.map((t) => img(t, { flex: 1, height: 300, borderRadius: 18 }))
          : [h('div', { flex: 1, height: 300, borderRadius: 18, background: C.paper3 })])
      ),
      h(
        'div',
        { flex: 1, justifyContent: 'space-between', alignItems: 'flex-end', gap: 32 },
        h(
          'div',
          { flexDirection: 'column', gap: 14, maxWidth: 820 },
          kicker(c.label),
          h(
            'div',
            { fontFamily: DISPLAY, fontWeight: 700, fontSize: 60, lineHeight: 1.05, ...ellipsis },
            c.title
          ),
          h('div', { fontSize: 24, color: C.ink2, ...ellipsis }, c.sub)
        ),
        brand(site)
      )
    )
  );
}

export function cardElement(card: CardData, site = 'Auto Tournament'): El {
  switch (card.kind) {
    case 'clip':
      return clipCard(card, site);
    case 'match':
      return matchCard(card, site);
    case 'team':
      return teamCard(card, site);
    case 'player':
      return playerCard(card, site);
    case 'tournament':
      return tournamentCard(card, site);
    case 'reel':
      return reelCard(card, site);
  }
}

/** Drop every picture from a card (the fallback when one can't be decoded). */
function withoutImages(card: CardData): CardData {
  const clean = JSON.parse(
    JSON.stringify(card, (_k, v: unknown) =>
      v && typeof v === 'object' && 'data' in (v as object) && 'type' in (v as object) ? null : v
    )
  ) as CardData;
  if (clean.kind === 'reel') clean.thumbnails = [];
  return clean;
}

/** The card as a PNG. A picture that can't be drawn is left out rather than failing the card. */
export async function renderCard(card: CardData, opts: { site?: string } = {}): Promise<Buffer> {
  const site = opts.site?.trim() || 'Auto Tournament';
  const { fonts } = await setup();
  const draw = async (c: CardData) => {
    const svg = await satori(cardElement(c, site) as unknown as Parameters<typeof satori>[0], {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts,
    });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng();
    return Buffer.from(png);
  };
  try {
    return await draw(card);
  } catch {
    return draw(withoutImages(card));
  }
}
