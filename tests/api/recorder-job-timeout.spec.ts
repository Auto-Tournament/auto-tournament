import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test(
  'recorder job timeout accepts positive integers and otherwise keeps 45 minutes',
  { tag: ['@api', '@recorders'] },
  () => {
    for (const value of [
      undefined,
      '',
      '0',
      '-1',
      '1.5',
      'invalid',
      'Infinity',
      '9007199254740992',
      '21600',
    ]) {
      const env: NodeJS.ProcessEnv = { ...process.env, AT_NO_DB: '1' };
      delete env.CS2_RECORDER_JOB_SECONDS;
      if (value !== undefined) env.CS2_RECORDER_JOB_SECONDS = value;
      // A fresh process evaluates the module's startup configuration for each case.
      const output = execFileSync(
        process.execPath,
        [
          '--require',
          'tsx/cjs',
          '-e',
          "process.stdout.write(String(require('./api/src/integrations/cs2/demos/recorderLeases.ts').RECORDER_JOB_SECONDS));",
        ],
        { env, encoding: 'utf8' }
      );
      expect(Number(output.trim()), `CS2_RECORDER_JOB_SECONDS=${value}`).toBe(
        value === '21600' ? 21600 : 2700
      );
    }
  }
);
