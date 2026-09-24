import path from 'path';
import { test, expect } from '@playwright/test';
import { ESLint, Linter } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';

/**
 * Boundary lint for the game-integration split (3.0, step 1 PR 3).
 *
 * `yarn lint` enforces the rule on the real tree as an error, with no
 * allowlist (3.0 phase C, PR 14). This spec proves the rule actually fires on the
 * imports it must forbid, and that eslint.config.mjs applies it to the API and
 * the client, so disabling or mis-wiring it fails a test instead of silently
 * letting core code import CS2 internals again.
 *
 * @tag api
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const RULE_ID = 'local/integration-boundaries';

async function lint(file: string, code: string): Promise<string[]> {
  const { default: plugin } = await import('../../eslint-rules/integration-boundaries.mjs');
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    code,
    [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
        plugins: { local: plugin },
        rules: { [RULE_ID]: 'error' },
      },
    ],
    path.join(REPO_ROOT, file)
  );
  const fatal = messages.filter((m) => m.fatal);
  expect(fatal, JSON.stringify(fatal)).toEqual([]);
  return messages.filter((m) => m.ruleId === RULE_ID).map((m) => m.messageId ?? m.message);
}

test.describe('Integration boundary lint', () => {
  test('core may import the registry and the shared types', async () => {
    expect(
      await lint(
        'api/src/services/matchService.ts',
        [
          "import { getIntegration } from '../integrations/registry';",
          "import type { GameIntegration } from '../integrations/types';",
          "import { db } from '../config/database';",
          "import express from 'express';",
        ].join('\n')
      )
    ).toEqual([]);
  });

  test('core must not import an integration directly, in any import form', async () => {
    expect(
      await lint(
        'api/src/services/matchService.ts',
        [
          "import { cs2Integration } from '../integrations/cs2';",
          "import { x } from '../integrations/cs2/index';",
          "export { y } from '../integrations/cs2/matchConfig';",
          "export * from '../integrations/manual-report';",
          "const m = await import('../integrations/cs2');",
          "const r = require('../integrations/cs2');",
        ].join('\n')
      )
    ).toEqual(Array(6).fill('coreToIntegration'));
  });

  test('core deeper in the tree is resolved by path, not by pattern', async () => {
    expect(
      await lint('api/src/routes/v2/matches.ts', "import { a } from '../../integrations/cs2/veto/state';")
    ).toEqual(['coreToIntegration']);
  });

  test('no legacy exceptions are left', async () => {
    // The last ones (PR 7b): the scheduler and the tournament routes reached
    // CS2 services directly. Both now go through the registry.
    expect(
      await lint(
        'api/src/core/scheduler.ts',
        "import { rconService } from '../integrations/cs2/services/rconService';"
      )
      // Both rules fire: it is CS2 code, and rconService is banned from core.
    ).toEqual(['coreForbiddenModule', 'coreToIntegration']);
    expect(
      await lint(
        'api/src/routes/tournament.ts',
        "import { serverService } from '../integrations/cs2/services/serverService';"
      )
    ).toEqual(['coreToIntegration']);
  });

  test('the legacy allowlist is gone from the rule', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(path.join(REPO_ROOT, 'eslint-rules/integration-boundaries.mjs'), 'utf8');
    expect(source).not.toMatch(/LEGACY_CORE_IMPORTS|isLegacyCoreImport/);
  });

  test('api/src/core must not import rconService or the Auto Tournament CS2 event types by any path', async () => {
    expect(
      await lint(
        'api/src/core/scheduler.ts',
        [
          // Through a core-looking path (a copy or re-export shim) ...
          "import { rconService } from '../services/rconService';",
          "import type { PluginEvent } from '../types/plugin-events.types';",
          "import type { E } from '../types/plugin-events';",
          // ... an alias path ...
          "import { rcon } from '@/services/rconService';",
          // ... any import form, deeper in core.
          "const r = require('../../somewhere/rconService.ts');",
        ].join('\n')
      )
    ).toEqual(Array(5).fill('coreForbiddenModule'));
    expect(
      await lint('api/src/core/sub/x.ts', "export * from '../../integrations/cs2/events/plugin-events.types';")
    ).toEqual(['coreForbiddenModule', 'coreToIntegration']);
  });

  test('the core-only rule leaves the rest of the tree and look-alike names alone', async () => {
    // Outside api/src/core, rule 1 alone decides (a core-path import is fine).
    expect(await lint('api/src/services/x.ts', "import { a } from '../utils/rconService';")).toEqual([]);
    // The CS2 integration owns these modules.
    expect(
      await lint('api/src/integrations/cs2/allocation.ts', "import { rconService } from './services/rconService';")
    ).toEqual([]);
    // Only the exact module names.
    expect(
      await lint('api/src/core/scheduler.ts', "import { x } from '../services/rconServiceHelpers';")
    ).toEqual([]);
  });

  test('an integration may import its own files and the shared types', async () => {
    expect(
      await lint(
        'api/src/integrations/cs2/events/normalize.ts',
        [
          "import type { NormalizedEvent } from '../../types';",
          "import { parse } from '../matchConfig';",
          "import { helper } from './helper';",
          "import { db } from '../../../config/database';",
        ].join('\n')
      )
    ).toEqual([]);
  });

  test('an integration must not import another integration', async () => {
    expect(
      await lint(
        'api/src/integrations/manual-report/index.ts',
        [
          "import { cs2Integration } from '../cs2';",
          "import { a } from '../cs2/veto/state';",
        ].join('\n')
      )
    ).toEqual(['crossIntegration', 'crossIntegration']);
    expect(
      await lint('api/src/integrations/cs2/events/x.ts', "import { b } from '../../manual-report/report';")
    ).toEqual(['crossIntegration']);
  });

  test('an integration must not import the registry', async () => {
    expect(
      await lint('api/src/integrations/cs2/index.ts', "import { getIntegration } from '../registry';")
    ).toEqual(['integrationToRegistry']);
  });

  test('the registry and the shared types are not restricted', async () => {
    expect(
      await lint('api/src/integrations/registry.ts', "import { cs2Integration } from './cs2';")
    ).toEqual([]);
  });

  test('the same rules apply to the client', async () => {
    expect(
      await lint('client/src/pages/TeamMatch.tsx', "import { MatchPanel } from '../integrations/cs2/MatchPanel';")
    ).toEqual(['coreToIntegration']);
    expect(
      await lint('client/src/pages/TeamMatch.tsx', "import { slotFor } from '../integrations/registry';")
    ).toEqual([]);
    expect(
      await lint('client/src/integrations/cs2/MatchPanel.tsx', "import { X } from '../manual-report/Panel';")
    ).toEqual(['crossIntegration']);
  });

  test('eslint.config.mjs turns the rule on for API and client sources', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    for (const file of ['api/src/services/matchService.ts', 'client/src/App.tsx']) {
      const config = await eslint.calculateConfigForFile(path.join(REPO_ROOT, file));
      const setting = config.rules?.[RULE_ID];
      expect(Array.isArray(setting) ? setting[0] : setting, file).toBe(2);
    }
  });
});
