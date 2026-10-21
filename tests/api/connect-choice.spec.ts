import { test, expect } from '@playwright/test';
import {
  isPrivateIp,
  onServerNetwork,
  sameLan,
} from '../../api/src/integrations/cs2/fleet/connectChoice';

/**
 * LAN or public address (fleet/connectChoice.ts): a viewer on the server's network (a private
 * address, or the machine's public address = the same NAT) gets the LAN address.
 */

test.describe('connect choice', { tag: ['@api', '@unit'] }, () => {
  test('private addresses', () => {
    for (const ip of [
      '10.1.2.3',
      '172.18.50.9',
      '192.168.50.196',
      '100.64.0.1',
      '::ffff:192.168.1.5',
      'fd00::1',
    ])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['93.124.130.170', '172.32.0.1', '8.8.8.8', '2001:4860::1'])
      expect(isPrivateIp(ip), ip).toBe(false);
  });

  test('on the server network: private, or the machine public address', async () => {
    expect(await onServerNetwork('192.168.50.20', '93.124.130.170')).toBe(true);
    expect(await onServerNetwork('93.124.130.170', '93.124.130.170')).toBe(true);
    expect(await onServerNetwork('::ffff:93.124.130.170', '93.124.130.170')).toBe(true);
    expect(await onServerNetwork('81.166.209.188', '93.124.130.170')).toBe(false);
    expect(await onServerNetwork(null, '93.124.130.170')).toBe(false);
    expect(await onServerNetwork('81.166.209.188', null)).toBe(false);
  });

  test('a join from the machine LAN: same /24 as its own address', () => {
    expect(sameLan('192.168.50.108', '192.168.50.196')).toBe(true);
    // Through the router (hairpin): still the LAN.
    expect(sameLan('192.168.50.1', '192.168.50.196')).toBe(true);
    expect(sameLan('::ffff:192.168.50.7', '192.168.50.196')).toBe(true);
    // A tunnel's address or a remote player: not the LAN.
    expect(sameLan('10.8.0.2', '192.168.50.196')).toBe(false);
    expect(sameLan('81.166.209.188', '192.168.50.196')).toBe(false);
    expect(sameLan('loopback', '192.168.50.196')).toBe(false);
  });
});
