/**
 * The public keys license keys are checked against, by `kid`: raw 32-byte
 * Ed25519 keys, base64url, the same entries as the website's
 * `src/lib/license/public-keys.json` (Auto-Tournament/website).
 *
 * Rotating: add the new key's entry here and keep the old ones, so keys
 * signed before the rotation stay valid. Public keys are not secret.
 */

export interface LicensePublicKey {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
}

export const LICENSE_PUBLIC_KEYS: Readonly<Record<string, LicensePublicKey>> = {
  tWl_YS3_AzLgqdkm: {
    kty: 'OKP',
    crv: 'Ed25519',
    x: 'YQMKIdrQtVz-QFV3Tw0AWa7RivnNtjK6PiJzskg8R0g',
  },
};
