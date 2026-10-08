import { expect, test } from '@playwright/test';
import { musicFilter, parseMusicSetting } from '../../api/src/integrations/cs2/demos/music';
import { MUSIC_SUGGESTIONS } from '../../api/src/integrations/cs2/demos/musicSuggestions';

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
    expect(plain).toContain('volume=0.11,');
    expect(plain).toContain('afade=t=in:d=1.5');
    expect(plain).toContain('afade=t=out:st=17.500:d=2.5');
    expect(musicFilter(20, 3)).toContain("volume='if(lt(t,3.000),0.32,");
    expect(musicFilter(20, 0, -3.5)).toContain('volume=-3.5dB,volume=0.11,');
  });
});
