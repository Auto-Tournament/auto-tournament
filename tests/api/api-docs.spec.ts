import { test, expect } from '@playwright/test';

/**
 * `/api-docs` — the interactive API reference every install serves.
 *
 * This is the page the docs send a bot author to, and it was blank on every
 * Docker install. `swagger-ui-express` serves Swagger UI's CSS and JS out of
 * `node_modules/swagger-ui-dist`, and the release image has no `node_modules`
 * at all — the backend is one esbuild bundle. esbuild inlines a dependency's
 * *code*; it cannot inline a folder of static files. So the HTML loaded, its
 * stylesheet and script fell through to the SPA and came back as
 * `index.html`, and the page rendered as nothing.
 *
 * Nothing caught it because the page answered 200 the whole time. What
 * follows therefore checks what came back, not that something did.
 *
 * CI runs these against the real release image (`docker/docker-compose.ci.yml`
 * pulls the built image rather than mounting the source), which is the only
 * place the bug existed.
 *
 * @tag api
 * @tag docs
 */

test.describe('The API docs page', () => {
  test('serves Swagger UI, not the single-page app', { tag: ['@api', '@docs'] }, async ({
    request,
  }) => {
    const page = await request.get('/api-docs/');
    expect(page.ok(), `the page itself: ${page.status()}`).toBe(true);
    const html = await page.text();
    expect(html).toContain('swagger-ui');
    // The tab said "Auto Tournament CS2 API Docs" until 3.0 renamed the project.
    expect(html).toContain('<title>Auto Tournament API</title>');
    expect(html).not.toContain('Auto Tournament CS2 API Docs');

    // Every asset the page asks for. A wrong one is not a 404 — it is the
    // SPA's index.html with a 200 and `text/html`, which is exactly why this
    // asserts the content type rather than the status.
    const assets: Array<[string, string, string]> = [
      ['swagger-ui.css', 'text/css', '.swagger-ui'],
      ['swagger-ui-bundle.js', 'javascript', 'SwaggerUIBundle'],
      ['swagger-ui-standalone-preset.js', 'javascript', 'SwaggerUIStandalonePreset'],
      // Generated in-process by swagger-ui-express, so it worked even when
      // the rest did not. Here so a regression that breaks it is not silent.
      ['swagger-ui-init.js', 'javascript', 'swaggerDoc'],
    ];

    for (const [file, type, marker] of assets) {
      const response = await request.get(`/api-docs/${file}`);
      expect(response.ok(), `${file}: ${response.status()}`).toBe(true);
      expect(response.headers()['content-type'], `${file} content type`).toContain(type);
      const body = await response.text();
      expect(body, `${file} should be the real asset, not index.html`).not.toContain('<!DOCTYPE html>');
      expect(body, `${file} should contain ${marker}`).toContain(marker);
    }
  });

  test('serves the OpenAPI spec, with the endpoints a bot needs', { tag: ['@api', '@docs'] }, async ({
    request,
  }) => {
    const response = await request.get('/api-docs.json');
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('application/json');

    const spec = (await response.json()) as { paths?: Record<string, unknown> };
    const paths = Object.keys(spec.paths ?? {});
    expect(paths.length, 'the spec should describe the whole API').toBeGreaterThan(150);

    // The committed spec is the one a release serves (`resolveOpenApiSpec`),
    // and it is what a Discord bot author reads first.
    expect(paths).toContain('/api/players/by-discord-id/{discordId}');
    expect(paths).toContain('/api/teams');
  });
});
