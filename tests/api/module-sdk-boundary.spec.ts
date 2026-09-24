import path from 'path';
import { test, expect } from '@playwright/test';
import { ESLint, Linter } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';

/**
 * Module SDK boundary lint (item 8c, DESIGN-module-client-api.md).
 *
 * A client game module (`client/src/integrations/<id>/**`) may import platform
 * code only from `client/src/module-sdk` and `integrations/types`, and must use
 * the host's copy of the shared packages. This spec proves the rule fires on
 * the imports it must report, leaves the allowed ones alone, and is wired
 * into eslint.config.mjs as an error on integration files only (a warning on
 * the two CS2 setup steps still being rewritten).
 *
 * @tag api
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const RULE_ID = 'module-sdk/module-sdk-boundary';

async function lint(file: string, code: string): Promise<string[]> {
  const { default: plugin } = await import('../../eslint-rules/module-sdk-boundary.mjs');
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    code,
    [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
        plugins: { 'module-sdk': plugin },
        rules: { [RULE_ID]: 'warn' },
      },
    ],
    path.join(REPO_ROOT, file)
  );
  const fatal = messages.filter((m) => m.fatal);
  expect(fatal, JSON.stringify(fatal)).toEqual([]);
  return messages.filter((m) => m.ruleId === RULE_ID).map((m) => m.messageId ?? m.message);
}

test.describe('Module SDK boundary lint', () => {
  test('a module may import its own files, the SDK, the contract and shared packages', async () => {
    expect(
      await lint(
        'client/src/integrations/cs2/veto/VetoInterface.tsx',
        [
          "import { useState } from 'react';",
          "import { jsx } from 'react/jsx-runtime';",
          "import { Box, Button } from '@mui/material';",
          "import { useTheme } from '@mui/material/styles';",
          "import { useNavigate } from 'react-router-dom';",
          "import { useTranslation } from 'react-i18next';",
          "import CloseIcon from '@mui/icons-material/Close';",
          "import { DndContext } from '@dnd-kit/core';",
          "import { api, useSnackbar } from '../../../module-sdk';",
          "import { tokens } from '../../../module-sdk/index';",
          "import type { PreMatchViewProps } from '../../types';",
          "import { VetoCard } from './VetoCard';",
          "import { helper } from '../setup/helper';",
        ].join('\n')
      )
    ).toEqual([]);
  });

  test('platform code outside the SDK is reported, in any import form and at any depth', async () => {
    expect(
      await lint(
        'client/src/integrations/cs2/veto/VetoInterface.tsx',
        [
          "import { api } from '../../../utils/api';",
          "import type { MapPool } from '../../../types/api.types';",
          "import { useAuth } from '../../../contexts/AuthContext';",
          "export { paths } from '../../../paths';",
          "export * from '../../../hooks/useThing';",
          "const m = await import('../../../components/modals/MatchDetailsModal');",
          "const r = require('../../../theme/tokens');",
        ].join('\n')
      )
    ).toEqual(Array(7).fill('platformImport'));
    expect(
      await lint('client/src/integrations/manual-report/index.ts', "import { x } from '../../utils/x';")
    ).toEqual(['platformImport']);
    // Reaching out of client/src altogether counts too.
    expect(
      await lint('client/src/integrations/cs2/index.tsx', "import { y } from '../../../../shared/y';")
    ).toEqual(['platformImport']);
  });

  test('the message names the module and the core file it reached', async () => {
    const { default: plugin } = await import('../../eslint-rules/module-sdk-boundary.mjs');
    const linter = new Linter({ configType: 'flat' });
    const [msg] = linter.verify(
      "import { api } from '../../utils/api.ts';",
      [
        {
          files: ['**/*.tsx'],
          languageOptions: { parser: tsParser },
          plugins: { 'module-sdk': plugin },
          rules: { [RULE_ID]: 'warn' },
        },
      ],
      path.join(REPO_ROOT, 'client/src/integrations/cs2/index.tsx')
    );
    expect(msg.message).toContain("'cs2'");
    expect(msg.message).toContain("'utils/api'");
  });

  test('a subpath of a shared package that is not itself shared is reported', async () => {
    expect(
      await lint(
        'client/src/integrations/cs2/servers/ServerGrid.tsx',
        [
          "import Box from '@mui/material/Box';",
          "import Grid from '@mui/material/Grid';",
          "import { createRoot } from 'react-dom/client';",
        ].join('\n')
      )
    ).toEqual(Array(3).fill('sharedSubpath'));
  });

  test('packages whose state the host owns are reported, except for type-only imports', async () => {
    expect(
      await lint(
        'client/src/integrations/manual-report/match/ManualReportPanel.tsx',
        [
          "import { io } from 'socket.io-client';",
          "import { useSnackbar } from 'notistack';",
          "import type { SnackbarKey } from 'notistack';",
          "import { type Socket } from 'socket.io-client';",
        ].join('\n')
      )
    ).toEqual(['hostPackage', 'hostPackage']);
  });

  test('other integrations and the registry are left to integration-boundaries', async () => {
    expect(
      await lint(
        'client/src/integrations/cs2/index.tsx',
        ["import { a } from '../manual-report/x';", "import { getIntegration } from '../registry';"].join('\n')
      )
    ).toEqual([]);
  });

  test('core, the registry, the contract and the SDK itself are not restricted', async () => {
    for (const file of [
      'client/src/pages/Manage.tsx',
      'client/src/integrations/registry.ts',
      'client/src/integrations/types.ts',
      'client/src/module-sdk/index.ts',
      'api/src/integrations/cs2/index.ts',
    ]) {
      expect(await lint(file, "import { api } from '../utils/api';\nimport Box from '@mui/material/Box';"), file).toEqual(
        []
      );
    }
  });

  test('eslint.config.mjs makes the rule an error for client integrations only', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const severity = async (file: string) => {
      const config = await eslint.calculateConfigForFile(path.join(REPO_ROOT, file));
      const setting = config.rules?.[RULE_ID];
      return Array.isArray(setting) ? setting[0] : setting;
    };
    expect(await severity('client/src/integrations/cs2/index.tsx')).toBe(2);
    expect(await severity('client/src/integrations/cs2/setup/SortableMapList.tsx')).toBe(2);
    expect(await severity('client/src/integrations/manual-report/index.ts')).toBe(2);
    expect(await severity('client/src/App.tsx')).toBeUndefined();
  });

  test('only the two CS2 setup steps still being rewritten are a warning', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    for (const file of [
      'client/src/integrations/cs2/setup/Cs2MatchSettings.tsx',
      'client/src/integrations/cs2/setup/MapPoolStep.tsx',
    ]) {
      const config = await eslint.calculateConfigForFile(path.join(REPO_ROOT, file));
      const setting = config.rules?.[RULE_ID];
      expect(Array.isArray(setting) ? setting[0] : setting, file).toBe(1);
    }
  });
});
