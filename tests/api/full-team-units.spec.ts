import { test, expect } from '@playwright/test';
import {
  botsPlay,
  fullTeamMinutesOf,
  fullTeamPending,
  shortSides,
} from '../../api/src/services/walkoverOffers';

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

  test('auto-start waits while a team is short and the timer runs', () => {
    const team = (on: number) => ({
      side: 'team1' as const,
      teamId: 't',
      name: 't',
      players: Array.from({ length: 5 }, (_, i) => ({
        steamId: String(i),
        name: String(i),
        sub: false,
        onServer: i < on,
      })),
      out: [],
    });
    const state = (on2: number, offer = false) => ({
      deadline: 1000,
      size: 5,
      teams: [team(5), { ...team(on2), side: 'team2' as const }],
      offer: offer ? { shortSide: 'team2', expiresAt: 1120, decided: null } : null,
    });
    expect(fullTeamPending(state(3), 900)).toBe(true);
    expect(fullTeamPending(state(3), 1010)).toBe(true);
    expect(fullTeamPending(state(3), 1015)).toBe(false);
    expect(fullTeamPending(state(5), 900)).toBe(false);
    expect(fullTeamPending(state(3, true), 900)).toBe(false);
    expect(fullTeamPending({ ...state(3), deadline: null }, 900)).toBe(false);
    expect(fullTeamPending(null, 900)).toBe(false);
  });
});
