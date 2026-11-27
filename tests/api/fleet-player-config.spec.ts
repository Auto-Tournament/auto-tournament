import { test, expect } from '@playwright/test';
import { validatePayload } from '../../api/src/integrations/cs2/fleet/protocol/v1';
import { withConfigOff } from '../../api/src/integrations/cs2/fleet/assignConfig';
import {
  autoexec,
  cleanCode,
  cleanCvars,
  cleanGear,
  CONFIG_CVARS,
} from '../../api/src/integrations/cs2/playerConfig';

/**
 * A player's CS2 config (the profile's Config tab): what Ready Up's `player.config` carries is
 * checked against the list the profile shows, the gear a player types is bounded, and the
 * autoexec.cfg is built from both. Pure parts; the message passes its protocol schema.
 */

const CODE = 'CSGO-a2Rkq-PJ7rN-wbQYm-9AVqS-5PbYB';

test.describe('player config', { tag: ['@api'] }, () => {
  test('player.config passes its schema; junk does not', () => {
    const ok = {
      steamid64: '76561198000000001',
      crosshair_code: CODE,
      cvars: { sensitivity: '1.25', viewmodel_fov: '68' },
    };
    expect(validatePayload('player.config', ok)).toEqual({ ok: true, errors: [] });
    expect(validatePayload('player.config', { steamid64: '76561198000000001' }).ok).toBe(false);
    expect(
      validatePayload('player.config', { steamid64: '1', cvars: { sensitivity: 1.25 } }).ok
    ).toBe(false);
  });

  test('only listed cvars with plain numbers are kept', () => {
    expect(
      cleanCvars({
        sensitivity: ' 1.25 ',
        viewmodel_offset_z: '-1.5',
        cl_crosshairsize: '2',
        rcon_password: '1234', // not on the list
        cl_hud_color: 'red; quit', // not a number
        fps_max: 0, // not a string
      })
    ).toEqual({ sensitivity: '1.25', viewmodel_offset_z: '-1.5', cl_crosshairsize: '2' });
    // CS2's on/off cvars answer true / false: kept as 1 / 0.
    expect(
      cleanCvars({ cl_crosshairdot: 'false', cl_radar_rotate: 'true', cl_crosshair_t: 'TRUE' })
    ).toEqual({ cl_crosshairdot: '0', cl_radar_rotate: '1', cl_crosshair_t: '1' });
    expect(cleanCvars(null)).toEqual({});
    expect(cleanCvars(['sensitivity'])).toEqual({});
  });

  test('a crosshair code, or null', () => {
    expect(cleanCode(CODE)).toBe(CODE);
    // Today's CS2 code (csgo-sharecode's documented example).
    expect(cleanCode('CSvbPubOq37zTGqtsPTP5QTrp5CB4xFXiKRLfzJsm49ZRe')).toBe(
      'CSvbPubOq37zTGqtsPTP5QTrp5CB4xFXiKRLfzJsm49ZRe'
    );
    expect(cleanCode('CSGO-short')).toBeNull();
    expect(cleanCode(`${CODE}; quit`)).toBeNull();
    expect(cleanCode(42)).toBeNull();
  });

  test('gear: trimmed text, bounded numbers, known scaling', () => {
    expect(
      cleanGear({
        mouse: '  Logitech G Pro X Superlight 2 ',
        keyboard: 'x'.repeat(200),
        dpi: '800',
        pollingHz: 1000,
        refreshHz: 99999,
        resolution: '1280 x 960',
        scaling: 'stretched',
        evil: 'no',
      })
    ).toEqual({
      mouse: 'Logitech G Pro X Superlight 2',
      keyboard: 'x'.repeat(80),
      dpi: 800,
      pollingHz: 1000,
      resolution: '1280×960',
      scaling: 'stretched',
    });
    expect(cleanGear({ scaling: 'zoomed', dpi: 1.5, resolution: 'big' })).toEqual({});
  });

  test('autoexec: the cvars in list order, then the crosshair code', () => {
    const cfg = autoexec('Sivert', { viewmodel_fov: '68', sensitivity: '1.25' }, CODE);
    const lines = cfg.trim().split('\n');
    expect(lines[0]).toContain("Sivert's CS2 config");
    expect(lines.slice(1)).toEqual([
      'sensitivity "1.25"',
      'viewmodel_fov "68"',
      `apply_crosshair_code ${CODE}`,
      'host_writeconfig',
    ]);
    // A name cannot break out of the comment line.
    expect(autoexec('a\nquit', {}, null).split('\n')[0]).toBe(
      "// a quit's CS2 config, from Auto Tournament"
    );
    expect(CONFIG_CVARS).toContain('cl_crosshairsize');
  });

  test('match.assign: read_config false on the players who turned it off, nothing on the rest', () => {
    const side = (ids: string[]) => ({
      name: 'T',
      players: ids.map((steamid64) => ({ steamid64, name: steamid64 })),
    });
    const config = { team1: side(['1', '2']), team2: side(['3']) } as unknown as Parameters<
      typeof withConfigOff
    >[0];
    const out = withConfigOff(config, new Set(['2', '3']));
    expect(out.team1.players.map((p) => p.read_config)).toEqual([undefined, false]);
    expect(out.team2.players.map((p) => p.read_config)).toEqual([false]);
    expect(withConfigOff(config, new Set())).toBe(config);
  });
});
