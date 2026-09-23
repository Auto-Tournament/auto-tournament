/**
 * A module's square tile, drawn inline so it follows the active theme.
 *
 * The tiles in `client/public/games` write every fill as
 * `fill="var(--at-ember, #ff6a3d)"`, and the page declares those variables
 * for the active theme (`theme/moduleIcons.ts`). Through an `<img>` that does
 * nothing at all: an `<img>` is a separate document, page CSS never reaches
 * into it, and the tiles stayed brand-orange under every theme. So the file
 * is fetched and its `<svg>` put in the page, where `:root`'s variables
 * inherit into it like any other element.
 *
 * **It is not bundled.** Seventeen tiles are ~900 KB of markup after SVGO;
 * a `?raw` import or an eager `import.meta.glob` would put all of that in the
 * JS bundle, parsed on every page load, for one step of one wizard. Fetching
 * keeps them where they were — static files under `/games`, cached by the
 * browser and served by the CDN, one request each exactly as the `<img>`
 * made, and nothing at all for a user who never opens the step. The JS cost
 * is this file.
 *
 * Fetched markup is prepared once per URL and kept in a module-level cache,
 * so a second card with the same tile, or a remount, costs a `cloneNode`.
 *
 * ## What is done to the file
 *
 * - **The `style` attribute comes off.** Each tile carries its own Ember
 *   palette as `style="--at-ember:#ff6a3d;…"` on the `<svg>` — that is what
 *   makes the file right when it is opened on its own. Inline styles beat
 *   every page rule, so it has to go before `:root` can be heard. The
 *   per-fill `var()` fallbacks stay, so the file on disk is unchanged and
 *   still correct by itself.
 * - **`width`/`height` come off**, so the tile is sized by CSS. `viewBox`
 *   stays, which is what makes it scale.
 * - **Ids are scoped to the instance.** SVGO names every clip path `a`; two
 *   inlined tiles on one page would otherwise be two elements with `id="a"`,
 *   and `url(#a)` resolves to whichever came first.
 *
 * Only same-origin paths are inlined. A module that ever points `icon` at
 * another host gets an `<img>` — the tile will not be themed, but a third
 * party will not have put markup in our page either.
 */

import { useEffect, useId, useRef, useState } from 'react';
import Box from '@mui/material/Box';

/** Prepared markup per URL: the parsed `<svg>`, or `null` if it is unusable. */
const cache = new Map<string, Promise<SVGSVGElement | null>>();

/** Attributes that can carry a `url(#id)` reference to another element. */
const REFERENCE_ATTRIBUTES = [
  'clip-path',
  'fill',
  'filter',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'stroke',
];

/** A path on this origin, which is where every module tile is served from. */
function isSameOriginPath(src: string): boolean {
  return src.startsWith('/') && !src.startsWith('//');
}

function parseTile(markup: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg' || !(svg instanceof SVGSVGElement)) return null;
  if (!svg.getAttribute('viewBox')) return null;

  // The file's own Ember palette, and its 2048px box: the page supplies both.
  svg.removeAttribute('style');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  return svg;
}

async function loadTile(src: string): Promise<SVGSVGElement | null> {
  try {
    const response = await fetch(src, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? '';
    // A dev server or a single-page fallback answers a missing file with
    // index.html, which would parse as markup and render as nothing.
    if (!type.includes('svg')) return null;
    return parseTile(await response.text());
  } catch {
    return null;
  }
}

function tile(src: string): Promise<SVGSVGElement | null> {
  let pending = cache.get(src);
  if (!pending) {
    pending = loadTile(src);
    cache.set(src, pending);
  }
  return pending;
}

/** Rewrites `id="a"` and every `url(#a)` that points at it, for one instance. */
function scopeIds(svg: SVGSVGElement, scope: string): void {
  const renamed = new Map<string, string>();
  for (const element of Array.from(svg.querySelectorAll('[id]'))) {
    const id = element.getAttribute('id');
    if (!id) continue;
    const scoped = `${scope}-${id}`;
    renamed.set(id, scoped);
    element.setAttribute('id', scoped);
  }
  if (renamed.size === 0) return;

  for (const element of Array.from(svg.querySelectorAll('*'))) {
    for (const name of REFERENCE_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value || !value.includes('url(#')) continue;
      element.setAttribute(
        name,
        value.replace(/url\(#([^)]+)\)/g, (whole, id: string) => {
          const scoped = renamed.get(id.trim());
          return scoped ? `url(#${scoped})` : whole;
        })
      );
    }
    const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
    if (href?.startsWith('#')) {
      const scoped = renamed.get(href.slice(1));
      if (scoped) {
        if (element.hasAttribute('href')) element.setAttribute('href', `#${scoped}`);
        if (element.hasAttribute('xlink:href')) element.setAttribute('xlink:href', `#${scoped}`);
      }
    }
  }
}

export interface ModuleIconProps {
  /** The tile's URL, as the module declared it (`/games/…svg`). */
  src: string;
  /** Called when the tile cannot be fetched or parsed, so the card can fall
   *  back to its text mark. */
  onError?: () => void;
}

/**
 * Decorative by contract: every caller labels the card itself, so the tile is
 * hidden from assistive tech rather than repeating the game's name.
 */
export function ModuleIcon({ src, onError }: ModuleIconProps) {
  const scope = useId().replace(/[^a-zA-Z0-9-]/g, '');
  const host = useRef<HTMLDivElement>(null);
  const [inline, setInline] = useState(isSameOriginPath(src));

  useEffect(() => {
    if (!isSameOriginPath(src)) {
      setInline(false);
      return undefined;
    }
    setInline(true);
    let cancelled = false;

    void tile(src).then((svg) => {
      if (cancelled || !host.current) return;
      if (!svg) {
        onError?.();
        return;
      }
      const copy = svg.cloneNode(true) as SVGSVGElement;
      scopeIds(copy, scope);
      copy.setAttribute('aria-hidden', 'true');
      copy.setAttribute('focusable', 'false');
      copy.style.width = '100%';
      copy.style.height = '100%';
      copy.style.display = 'block';
      host.current.replaceChildren(copy);
    });

    return () => {
      cancelled = true;
    };
    // `onError` is the caller's identity-unstable arrow; re-fetching on every
    // render because of it would defeat the cache's whole point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, scope]);

  if (!inline) {
    return (
      <Box
        component="img"
        src={src}
        alt=""
        decoding="async"
        onError={onError}
        sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    );
  }

  return <Box ref={host} sx={{ width: '100%', height: '100%', display: 'block' }} />;
}
