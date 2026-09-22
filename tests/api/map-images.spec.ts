import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Map image upload -> static serve round trip.
 *
 * Regression test for the bug fixed alongside this file: in the bundled
 * build (and therefore Docker), `POST /api/maps/:id/upload-image` wrote the
 * file one directory above where `/map-images/*` actually serves from, so
 * an uploaded image never came back. See PR #284's "Judgement calls"
 * section and `api/src/config/publicPaths.ts`, which now derives both
 * paths from a single constant.
 *
 * @tag api
 * @tag maps
 */

// A 1x1 transparent PNG, inlined so this test needs no fixture file.
const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let counter = 0;
function uniqueMapId(): string {
  counter += 1;
  return `test_map_image_${Date.now()}_${counter}`;
}

async function createMap(request: APIRequestContext, id: string) {
  const res = await request.post('/api/maps', {
    data: { id, displayName: `Test Map ${id}` },
  });
  expect(res.ok(), `POST /api/maps: ${await res.text()}`).toBe(true);
}

async function deleteMap(request: APIRequestContext, id: string) {
  await request.delete(`/api/maps/${id}`);
}

test.describe('Map image upload', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test(
    'an uploaded image is reachable through /map-images',
    { tag: ['@api', '@maps'] },
    async ({ request }) => {
      const id = uniqueMapId();
      await createMap(request, id);

      try {
        const uploadRes = await request.post(`/api/maps/${id}/upload-image`, {
          data: { imageData: `data:image/png;base64,${ONE_PX_PNG_BASE64}` },
        });
        expect(uploadRes.ok(), `upload-image: ${await uploadRes.text()}`).toBe(true);
        const uploadBody = await uploadRes.json();
        expect(uploadBody.success).toBe(true);
        expect(uploadBody.imageUrl).toBe(`/map-images/${id}.png`);

        // The route only returns a relative URL; fetch it back exactly the
        // way a browser would, through the static /map-images mount.
        const imageRes = await request.get(uploadBody.imageUrl);
        expect(imageRes.ok(), `GET ${uploadBody.imageUrl}: ${imageRes.status()}`).toBe(true);
        expect(imageRes.headers()['content-type']).toContain('image/png');

        const bytes = await imageRes.body();
        expect(Buffer.compare(bytes, Buffer.from(ONE_PX_PNG_BASE64, 'base64'))).toBe(0);

        // The map record itself should also carry the URL.
        const mapRes = await request.get(`/api/maps/${id}`);
        expect(mapRes.ok(), `GET /api/maps/${id}: ${await mapRes.text()}`).toBe(true);
        const mapBody = await mapRes.json();
        expect(mapBody.map.imageUrl).toBe(`/map-images/${id}.png`);
      } finally {
        await deleteMap(request, id);
      }
    }
  );
});
