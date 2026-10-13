import { test, expect, request as playwrightRequest } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { withShareTags } from '../../api/src/routes/share';
import { isPrivateHost } from '../../api/src/services/shareCards/images';
import { initials } from '../../api/src/services/shareCards/render';
import { gameKey, mapLabel, roundLabel } from '../../api/src/services/shareCards/core';
import type { GameIntegration } from '../../api/src/integrations/types';

/**
 * Link previews: a shared match, team, player or tournament page carries its
 * own title, description and card image in its Open Graph tags, and
 * /og/<kind>/<key>.png draws the card (design: "Share card (OG image)").
 *
 * The page requests go through the image's Caddy like a chat app's crawler:
 * those paths are sent to the API, which fills in index.html.
 *
 * @tag api
 * @tag share
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@share'] };
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const LOGO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const meta = (html: string, key: string) =>
  html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1] ?? null;

test.describe('Share cards (pure)', () => {
  const HTML = `<html><head><title>Auto Tournament</title>
    <meta property="og:title" content="Auto Tournament" />
    <meta property="og:description" content="Tournaments that run themselves" />
    <meta property="og:image" content='{{env \`FRONTEND_BASE_URL\` | trimSuffix \`/\`}}/og.png' />
  </head><body></body></html>`;

  test('the page tags replace the generic ones, escaped', TAGS, () => {
    const out = withShareTags(HTML, 'https://cs.example.com', 'https://cs.example.com/t/team/x', {
      kind: 'team',
      key: 'x',
      title: 'Team "Alpha" <3',
      description: '12 wins, 5 losses in CS2',
      version: 'abc',
      imagePath: '/og/team/x.png?v=abc',
    });
    expect(meta(out, 'og:title')).toBe('Team &quot;Alpha&quot; &lt;3');
    expect(meta(out, 'og:image')).toBe('https://cs.example.com/og/team/x.png?v=abc');
    expect(meta(out, 'og:url')).toBe('https://cs.example.com/t/team/x');
    expect(meta(out, 'twitter:image')).toBe('https://cs.example.com/og/team/x.png?v=abc');
    expect(out).toContain('<title>Team &quot;Alpha&quot; &lt;3</title>');
    expect(out.match(/og:title/g)).toHaveLength(1);
  });

  test('no tags for the page: the generic ones, with the site address filled in', TAGS, () => {
    const out = withShareTags(
      HTML,
      'https://cs.example.com',
      'https://cs.example.com/match/now',
      null
    );
    expect(out).toContain(`content='https://cs.example.com/og.png'`);
    expect(meta(out, 'og:title')).toBe('Auto Tournament');
  });

  test(
    "a player's picked game is keyed like their ratings: a module's catalogue slug is its id",
    TAGS,
    () => {
      const installed = [
        { id: 'cs2', catalog: { slug: 'counter-strike-2', aliases: ['cs', 'csgo'] } },
        { id: 'manual-report', catalog: null },
      ] as unknown as GameIntegration[];
      expect(gameKey('counter-strike-2', installed)).toBe('cs2');
      expect(gameKey('CS', installed)).toBe('cs2');
      expect(gameKey('cs2', installed)).toBe('cs2');
      expect(gameKey('rocket-league', installed)).toBe('rocket-league');
    }
  );

  test('helpers: initials, map and round labels, private hosts', TAGS, () => {
    expect(initials('Team Alpha')).toBe('TA');
    expect(initials('ninjas')).toBe('NI');
    expect(mapLabel('de_mirage')).toBe('Mirage');
    expect(mapLabel(null)).toBeNull();
    expect(roundLabel('t3-gf', 4)).toBe('Grand final');
    expect(roundLabel('lb-r2m1', 2)).toBe('Lower bracket round 2');
    expect(roundLabel('r1m2', 1)).toBe('Round 1');
    for (const h of [
      'localhost',
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.50',
      '172.20.0.2',
      '169.254.169.254',
      '::1',
    ])
      expect(isPrivateHost(h), h).toBe(true);
    for (const h of ['avatars.steamstatic.com', '8.8.8.8', 'cdn.discordapp.com'])
      expect(isPrivateHost(h), h).toBe(false);
  });
});

test.describe.serial('Share cards', () => {
  test('a team page carries its card, and the card is a 1200×630 PNG', TAGS, async () => {
    const owner = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const id = `7656119${Date.now().toString().slice(-10)}`;
      expect(await signInAsPlayerViaRequest(owner, id, `Share ${id.slice(-4)}`)).toBe(true);
      const name = `Share Cards ${id.slice(-6)}`;
      const created = await owner.post('/api/team-directory/mine', { data: { name, tag: 'SHR' } });
      expect(created.ok(), await created.text()).toBe(true);
      const team = (await created.json()).team as { id: string };

      const page = await anon.get(`/t/team/${team.id}`);
      expect(page.status()).toBe(200);
      const html = await page.text();
      expect(meta(html, 'og:title')).toBe(name);
      const image = meta(html, 'og:image')!;
      expect(image).toMatch(new RegExp(`/og/team/${team.id}\\.png\\?v=`));

      const png = await anon.get(new URL(image).pathname + new URL(image).search);
      expect(png.status()).toBe(200);
      expect(png.headers()['content-type']).toBe('image/png');
      const body = await png.body();
      expect(body.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
      // IHDR: width and height at bytes 16-23.
      expect(body.readUInt32BE(16)).toBe(1200);
      expect(body.readUInt32BE(20)).toBe(630);

      // A new logo is a new card URL, so chat apps fetch it again.
      const base = `/api/team-directory/${team.id}`;
      expect(
        (
          await owner.put(`${base}/logo`, { data: LOGO, headers: { 'Content-Type': 'image/png' } })
        ).ok()
      ).toBe(true);
      const after = meta(await (await anon.get(`/t/team/${team.id}`)).text(), 'og:image');
      expect(after).not.toBe(image);
      expect((await anon.get(new URL(after!).pathname + new URL(after!).search)).status()).toBe(
        200
      );
    } finally {
      await owner.dispose();
      await anon.dispose();
    }
  });

  test('a player page: name and rating in its main game', TAGS, async () => {
    const player = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const id = `7656119${(Date.now() + 7).toString().slice(-10)}`;
      expect(
        await signInAsPlayerViaRequest(player, id, `Sharer ${id.slice(-4)}`, { games: ['cs2'] })
      ).toBe(true);
      const html = await (await anon.get(`/player/${id}`)).text();
      expect(meta(html, 'og:title')).toBe(`Sharer ${id.slice(-4)}`);
      expect(meta(html, 'og:description')).toMatch(/^Rating \d+ in Counter-Strike 2 · /);
      const image = meta(html, 'og:image')!;
      const png = await anon.get(new URL(image).pathname);
      expect(png.status()).toBe(200);
      expect((await png.body()).subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    } finally {
      await player.dispose();
      await anon.dispose();
    }
  });

  test(
    'a page with nothing behind it keeps the generic tags; unknown cards are 404',
    TAGS,
    async () => {
      const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        const html = await (await anon.get('/player/76561190000000000')).text();
        expect(meta(html, 'og:title')).toBe('Auto Tournament');
        expect(html).toMatch(/og:image" content='[^']*\/og\.png'/);
        expect((await anon.get('/og/player/76561190000000000.png')).status()).toBe(404);
        expect((await anon.get('/og/nope/x.png')).status()).toBe(404);
        // A path that climbs out is never a card (Caddy folds it to a path outside /og).
        const climb = await anon.get('/og/team/..%2F..%2Fetc.png');
        expect(climb.headers()['content-type'] ?? '').not.toContain('image/png');
        // The app still loads on those paths: it is the same index.html.
        expect(html).toContain('<div id="root"');
      } finally {
        await anon.dispose();
      }
    }
  );

  test('a tournament page carries its card', TAGS, async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: [
        'de_mirage',
        'de_inferno',
        'de_ancient',
        'de_anubis',
        'de_dust2',
        'de_vertigo',
        'de_nuke',
      ],
      teamCount: 4,
      serverCount: 0,
      prefix: 'share-card',
    });
    expect(setup, 'tournament setup failed').toBeTruthy();
    const id = setup!.tournament.id;
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      for (const page of [`/tournament/${id}`, `/tournament/${id}/bracket`]) {
        const html = await (await anon.get(page)).text();
        expect(meta(html, 'og:title'), page).toBe(setup!.tournament.name);
        const image = meta(html, 'og:image')!;
        expect(image).toMatch(new RegExp(`/og/tournament/${id}\\.png\\?v=`));
        const png = await anon.get(new URL(image).pathname);
        expect(png.status()).toBe(200);
        expect((await png.body()).subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
      }
    } finally {
      await anon.dispose();
      await request.delete('/api/tournament');
    }
  });
});
