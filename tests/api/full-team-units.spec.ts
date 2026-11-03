import { test, expect } from '@playwright/test';
import { botsPlay, fullTeamMinutesOf, shortSides } from '../../api/src/services/walkoverOffers';

/** "Getting on the server" (services/walkoverOffers.ts). Pure. */
test.describe('Full team timer', () => {
  test('minutes: the setting, else 10; 0 is off', () => {
    expect(fullTeamMinutesOf(null)).toBe(10);
    expect(fullTeamMinutesOf('{}')).toBe(10);
    expect(fullTeamMinutesOf('{"fullTeamMinutes":5}')).toBe(5);
    expect(fullTeamMinutesOf('{"fullTeamMinutes":0}')).toBe(0);
    expect(fullTeamMinutesOf('{"fullTeamMinutes":"x"}')).toBe(10);
    expect(fullTeamMinutesOf('not json')).toBe(10);
  });

  test('a team is short with fewer than a full team connected', () => {
    expect(shortSides(5, 5, 5)).toEqual({ team1: false, team2: false });
    expect(shortSides(4, 5, 5)).toEqual({ team1: true, team2: false });
    expect(shortSides(4, 3, 5)).toEqual({ team1: true, team2: true });
  });

  test('no timer when bots play: simulation or bot fill', () => {
    expect(botsPlay('{"simulation":true}')).toBe(true);
    expect(botsPlay('{"bot_fill":true}')).toBe(true);
    expect(botsPlay('{"simulation":false}')).toBe(false);
    expect(botsPlay(null)).toBe(false);
  });
});
