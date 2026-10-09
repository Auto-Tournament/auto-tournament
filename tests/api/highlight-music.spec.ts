import { expect, test } from '@playwright/test';
import { musicFilter, parseMusicSetting } from '../../api/src/services/highlights/music';
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
    expect(plain).toContain('volume=0.4,');
    expect(plain).toContain('afade=t=in:d=1.5');
    expect(plain).toContain('afade=t=out:st=17.500:d=2.5');
    expect(musicFilter(20, 3)).toContain("volume='if(lt(t,3.000),0.32,");
    expect(musicFilter(20, 0, -3.5)).toContain('volume=-3.5dB,volume=0.4,');
    // The viewer's level under the game (1: the whole track); the intro keeps its own.
    expect(musicFilter(20, 0, 0, 1)).toContain('volume=1,');
    const loud = musicFilter(20, 3, 0, 0.8);
    expect(loud).toContain("volume='if(lt(t,3.000),0.32,");
    expect(loud).toContain(',0.8))');
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
