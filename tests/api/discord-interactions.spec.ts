import { test, expect } from '@playwright/test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyDiscordSignature } from '../../api/src/addons/discord/interactionVerify';

/**
 * Slash commands come over Discord's Interactions Endpoint, signed with the
 * app's Ed25519 key: only a request signed by that key is answered.
 *
 * @tag api
 */
test.describe('Discord interaction signatures', () => {
  test('a request signed by the app is accepted; anything else is not', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    // Discord gives the raw 32-byte key as hex: the last 32 bytes of the SPKI form.
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    const body = Buffer.from('{"type":1}');
    const timestamp = '1792500000';
    const signature = sign(
      null,
      Buffer.concat([Buffer.from(timestamp), body]),
      privateKey
    ).toString('hex');
    expect(verifyDiscordSignature(raw, signature, timestamp, body)).toBe(true);
    expect(verifyDiscordSignature(raw, signature, '1792500001', body)).toBe(false);
    expect(verifyDiscordSignature(raw, signature, timestamp, Buffer.from('{"type":2}'))).toBe(
      false
    );
    expect(verifyDiscordSignature(raw, 'zz', timestamp, body)).toBe(false);
  });
});
