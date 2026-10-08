import { expect, test } from '@playwright/test';
import { musicFilter, parseMusicSetting } from '../../api/src/integrations/cs2/demos/music';
import { MUSIC_TRACKS } from '../../api/src/integrations/cs2/demos/musicTracks';

test.describe('reel music', () => {
  test(
    'the setting reads as every track, none, or the picked ones it knows',
    { tag: ['@api'] },
    () => {
      const [a, b] = MUSIC_TRACKS;
      expect(parseMusicSetting(null)).toBe('all');
      expect(parseMusicSetting('')).toBe('all');
      expect(parseMusicSetting('all')).toBe('all');
      expect(parseMusicSetting('off')).toBe('off');
      expect(parseMusicSetting(`${a!.id},999999999,${b!.id}`)).toEqual([a!.id, b!.id]);
      expect(parseMusicSetting('999999999')).toBe('off');
    }
  );

  test('every track has its own id, a Pixabay page and an MP3', { tag: ['@api'] }, () => {
    expect(new Set(MUSIC_TRACKS.map((t) => t.id)).size).toBe(MUSIC_TRACKS.length);
    for (const t of MUSIC_TRACKS) {
      expect(t.page).toMatch(new RegExp(`^https://pixabay\\.com/music/.+-${t.id}/$`));
      expect(t.audio).toMatch(/^https:\/\/cdn\.pixabay\.com\/download\/audio\/.+\.mp3$/);
    }
  });

  test('the music is faded and louder under the intro', { tag: ['@api'] }, () => {
    const plain = musicFilter(20, 0);
    expect(plain).toContain('volume=0.11,');
    expect(plain).toContain('afade=t=in:d=1.5');
    expect(plain).toContain('afade=t=out:st=17.500:d=2.5');
    expect(musicFilter(20, 3)).toContain("volume='if(lt(t,3.000),0.32,");
  });

  test('each track is evened out to the others before the reel level', { tag: ['@api'] }, () => {
    expect(musicFilter(20, 0, -3.5)).toContain('volume=-3.5dB,volume=0.11,');
    expect(musicFilter(20, 0, 0)).not.toContain('dB');
    for (const t of MUSIC_TRACKS) expect(Math.abs(t.gainDb)).toBeLessThan(12);
  });
});
