/**
 * Link previews (services/shareCards):
 *
 * - GET /og/:kind/:key.png — the page's share card (1200×630 PNG).
 * - GET on a shareable page (/match/…, /t/team/…, /player/…, /tournament/…,
 *   and the module pages such as CS2's /watch/…): the web app's index.html
 *   with that page's title, description and card in its Open Graph and
 *   Twitter tags, so a link pasted in Discord or on X shows the thing itself.
 *   Caddy sends these paths here (docker/Caddyfile); everything else about
 *   the page is the same single-page app.
 *
 * Public, read-only, no session needed: the cards show what the public pages
 * already show.
 */

import fs from 'fs';
import path from 'path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { PUBLIC_DIR } from '../config/publicPaths';
import { configuredPublicOrigin, publicOrigin } from '../utils/publicOrigin';
import { log } from '../utils/logger';
import { sharePageTags, shareCardPng, type SharePageTags } from '../services/shareCards';

const router = Router();

/** The page paths that may have a card. Anything else under them gets the plain app. */
export const SHARE_PAGE_PATHS = [
  '/match/*',
  '/team/*',
  '/t/team/*',
  '/player/*',
  '/tournament/*',
  '/watch/*',
];

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

let indexCache: { mtimeMs: number; html: string } | null = null;

/** index.html as built, or null when there is none (running from source). */
function indexHtml(): string | null {
  const file = path.join(PUBLIC_DIR, 'index.html');
  try {
    const stat = fs.statSync(file);
    if (indexCache?.mtimeMs !== stat.mtimeMs)
      indexCache = { mtimeMs: stat.mtimeMs, html: fs.readFileSync(file, 'utf8') };
    return indexCache.html;
  } catch {
    return null;
  }
}

/** Caddy's template for the site address in index.html, filled in as Caddy would. */
const ORIGIN_TEMPLATE = /\{\{\s*env\s+`FRONTEND_BASE_URL`\s*\|\s*trimSuffix\s+`\/`\s*\}\}/g;

/** index.html with the page's tags in place of the generic ones. Pure, for tests. */
export function withShareTags(
  html: string,
  origin: string,
  pageUrl: string,
  tags: SharePageTags | null
): string {
  let out = html.replace(ORIGIN_TEMPLATE, origin);
  if (!tags) return out;
  const image = `${origin}${tags.imagePath}`;
  const set = (attr: 'property' | 'name', key: string, value: string) => {
    const re = new RegExp(
      `<meta\\s+${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content=(?:"[^"]*"|'[^']*')\\s*/?>`,
      'i'
    );
    const tag = `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
    out = re.test(out) ? out.replace(re, tag) : out.replace('</head>', `    ${tag}\n  </head>`);
  };
  set('property', 'og:title', tags.title);
  set('property', 'og:description', tags.description);
  set('property', 'og:image', image);
  set('property', 'og:url', pageUrl);
  set('name', 'twitter:title', tags.title);
  set('name', 'twitter:description', tags.description);
  set('name', 'twitter:image', image);
  if (tags.description) set('name', 'description', tags.description);
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(tags.title)}</title>`);
  return out;
}

const originOf = (req: Request) =>
  (configuredPublicOrigin() ?? publicOrigin(req)).replace(/\/+$/, '');

router.get('/og/:kind/:file', async (req: Request, res: Response) => {
  const match = req.params.file.match(/^(.+)\.png$/);
  if (!match) return res.status(404).end();
  try {
    const png = await shareCardPng(req.params.kind, decodeURIComponent(match[1]));
    if (!png) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    // The page's tags version the URL; an unversioned fetch still refreshes every 10 minutes.
    res.setHeader('Cache-Control', req.query.v ? 'public, max-age=86400' : 'public, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(png);
  } catch (error) {
    log.warn('[SHARE] Could not draw a card', {
      kind: req.params.kind,
      error: (error as Error).message,
    });
    return res.status(500).end();
  }
});

async function sharePage(req: Request, res: Response, next: NextFunction) {
  const html = indexHtml();
  if (!html) return next();
  const origin = originOf(req);
  const tags = await sharePageTags(req.path).catch(() => null);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Like Caddy's index.html: always revalidated, so a new build is picked up.
  res.setHeader('Cache-Control', 'no-cache');
  return res.send(withShareTags(html, origin, `${origin}${req.path}`, tags));
}

router.get(SHARE_PAGE_PATHS, sharePage);

export default router;
