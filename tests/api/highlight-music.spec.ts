import { expect, test } from '@playwright/test';
import {
  gainFor,
  musicFilter,
  parseMusicSetting,
  rateEnergy,
} from '../../api/src/services/highlights/music';
import { MUSIC_SUGGESTIONS } from '../../api/src/services/highlights/musicSuggestions';

test.describe('reel music', () => {
  test(
    'the setting reads as every track, none, or the picked ones in the library',
    { tag: ['@api'] },
    () => {
      const library = new Set(['1', '2', '3']);
      expect(parseMusicSetting(null, library)).toBe('all');
      expect(parseMusicSetting('', library)).toBe('all');
      expect(parseMusicSetting('all', library)).toBe('all');
      expect(parseMusicSetting('off', library)).toBe('off');
      expect(parseMusicSetting('1,99,3', library)).toEqual(['1', '3']);
      expect(parseMusicSetting('99', library)).toBe('off');
    }
  );

  test('the suggestions are pages to visit, with no audio to fetch', { tag: ['@api'] }, () => {
    expect(MUSIC_SUGGESTIONS.length).toBeGreaterThan(10);
    for (const s of MUSIC_SUGGESTIONS) {
      expect(s.page).toMatch(/^https:\/\/pixabay\.com\/music\/.+-\d+\/$/);
      expect(JSON.stringify(s)).not.toMatch(/cdn\.pixabay\.com|\.mp3/);
    }
  });

  test('the music is evened out, faded and louder under the intro', { tag: ['@api'] }, () => {
    const plain = musicFilter(20, 0);
    expect(plain).toContain('volume=0.5,');
    expect(plain).toContain('afade=t=in:d=1.5');
    expect(plain).toContain('afade=t=out:st=17.500:d=2.5');
    expect(musicFilter(20, 3)).toContain("volume='if(lt(t,3.000),0.32,");
    expect(musicFilter(20, 0, -3.5)).toContain('volume=-3.5dB,volume=0.5,');
    // The viewer's level under the game (1: the whole track); the intro keeps its own.
    expect(musicFilter(20, 0, 0, 1)).toContain('volume=1,');
    const loud = musicFilter(20, 3, 0, 0.8);
    expect(loud).toContain("volume='if(lt(t,3.000),0.32,");
    expect(loud).toContain(',0.8))');
    // A raised track gets a limiter (no auto level) before the reel's level.
    expect(musicFilter(20, 0, 2.5)).toContain(
      'volume=2.5dB,alimiter=limit=0.891:level=0,volume=0.5,'
    );
  });

  test(
    'tracks are evened out by their loudness above 200 Hz, within ±4 dB',
    { tag: ['@api'] },
    () => {
      expect(gainFor(-13.1)).toBe(0);
      expect(gainFor(-15.2)).toBe(2.1);
      expect(gainFor(-25)).toBe(4);
      expect(gainFor(-3)).toBe(-4);
    }
  );

  test('energy: hype, mid and calm against the other tracks', { tag: ['@api'] }, () => {
    const track = (genre: string, flux: number) => ({ genre, flux, centroid: 2000, lra: 6 });
    // Too few to compare: no rating.
    expect(rateEnergy([1, 2, 3].map((f) => track('phonk', f)))).toEqual([]);
    // A third each, by how much the spectrum moves.
    expect(rateEnergy([0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((f) => track('phonk', f)))).toEqual([
      1, 1, 2, 2, 3, 3,
    ]);
    // A genre with 10 or more is rated on its own: its quietest is calm even
    // when it moves more than every track of another genre.
    const loud = Array.from({ length: 10 }, (_, i) => track('drum-n-bass', 1 + i / 10));
    const calm = [0.1, 0.2, 0.3].map((f) => track('lofi', f));
    const rated = rateEnergy([...loud, ...calm]);
    expect(rated[0]).toBe(1);
    expect(rated[9]).toBe(3);
    expect(rated.slice(10)).toEqual([1, 1, 1]);
  });
});

test.describe('Highlight music in core', () => {
  test(
    "the library is core's; the old CS2 addresses send you there",
    { tag: ['@api'] },
    async ({ request }) => {
      const list = await request.get('/api/highlights/music');
      expect(list.status()).toBe(200);
      const body = (await list.json()) as {
        tracks: unknown[];
        all: unknown[];
        suggestions: unknown[];
      };
      expect(
        Array.isArray(body.tracks) && Array.isArray(body.all) && body.suggestions.length > 0
      ).toBe(true);

      // A reel's music mix and a download with sound now come from core.
      const mix = await request.get('/api/game/cs2/highlights/reel-x.mp4/music/1?intro=2', {
        maxRedirects: 0,
      });
      expect(mix.status()).toBe(307);
      expect(mix.headers()['location']).toBe('/api/highlights/videos/reel-x.mp4/music/1?intro=2');
      // No such video: core answers 404.
      expect((await request.get('/api/highlights/videos/reel-x.mp4/music/1')).status()).toBe(404);
      expect((await request.get('/api/highlights/videos/..%2Fsecret.mp4/download')).status()).toBe(
        404
      );

      // Adding a track is for admins.
      expect(
        (await request.post('/api/highlights/music?title=x', { data: Buffer.from('x') })).status()
      ).toBe(401);
    }
  );
});
