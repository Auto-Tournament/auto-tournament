import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeServerCommands } from '../../client/src/integrations/cs2/pages/nativeRecorderSetup';

const TAGS = { tag: ['@api', '@recorders'] };

function setupFixture() {
  const root = mkdtempSync(join(tmpdir(), 'at-native-setup-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'git'),
    '#!/bin/sh\nprintf "%s\\n" "$*" > "$AT_TEST_GIT_LOG"\nmkdir -p at-native-recorder/worker\n',
    { mode: 0o755 }
  );
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" > "$AT_TEST_DOCKER_LOG"\n', {
    mode: 0o755,
  });
  return {
    root,
    bin,
    file: join(root, '.config/auto-tournament/native-recorder.env'),
    env: {
      ...process.env,
      HOME: root,
      PATH: `${bin}:${process.env.PATH}`,
      AT_TEST_GIT_LOG: join(root, 'git.log'),
      AT_TEST_DOCKER_LOG: join(root, 'docker.log'),
    },
  };
}

test('native setup builds upstream with a private environment file', TAGS, () => {
  const f = setupFixture();
  try {
    mkdirSync(join(f.root, '.config/auto-tournament'), { recursive: true });
    writeFileSync(f.file, 'old config', { mode: 0o644 });
    execFileSync(
      'bash',
      ['-c', nativeServerCommands('https://example.test', 'test-recorder-key')],
      { cwd: f.root, env: f.env }
    );
    expect(readFileSync(f.env.AT_TEST_GIT_LOG, 'utf8')).toContain(
      'https://github.com/Auto-Tournament/auto-tournament.git'
    );
    expect(readFileSync(f.file, 'utf8')).toBe(
      'AT_URL=https://example.test\nAT_WORKER_TOKEN=test-recorder-key\n'
    );
    expect(statSync(f.file).mode & 0o777).toBe(0o600);
    expect(existsSync(join(f.root, 'at-native-recorder/worker/native-plugins'))).toBe(true);
    expect(readFileSync(f.env.AT_TEST_DOCKER_LOG, 'utf8')).toBe(
      'compose -f native.compose.yml up -d --build\n'
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('native setup stops before saving credentials or starting Docker if clone fails', TAGS, () => {
  const f = setupFixture();
  try {
    writeFileSync(join(f.bin, 'git'), '#!/bin/sh\nexit 42\n', { mode: 0o755 });
    expect(() =>
      execFileSync(
        'bash',
        ['-c', nativeServerCommands('https://example.test', 'test-recorder-key')],
        { cwd: f.root, env: f.env, stdio: 'pipe' }
      )
    ).toThrow();
    expect(existsSync(f.file)).toBe(false);
    expect(existsSync(f.env.AT_TEST_DOCKER_LOG)).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
