import { test, expect } from '@playwright/test';
import { createProgress } from '../../client/src/integrations/cs2/servers/createProgress';

/**
 * The Servers page's "New server" tile reads csm's create-server progress steps
 * (csm's stepWriter, host_first_install.go) into a phase, a stage and the download.
 *
 * @tag api
 */

test.describe('Create-server progress from csm', () => {
  test('the CS2 download, with its size', () => {
    expect(
      createProgress(
        'Installing/updating master CS2 installation: downloading 79 % (58.1 of 73.4 GB)'
      )
    ).toEqual({ phase: 'download', stage: 2, pct: 79, doneGb: 58.1, totalGb: 73.4 });
  });

  test('checking the files, and SteamCMD steps without a size', () => {
    expect(
      createProgress('Installing/updating master CS2 installation: verifying install 37 %')
    ).toMatchObject({ phase: 'check', stage: 2, pct: 37, doneGb: null });
    expect(
      createProgress(
        'Installing/updating master CS2 installation: preallocating 12 % (9.0 of 73.4 GB)'
      )
    ).toMatchObject({ phase: 'install', pct: 12 });
    expect(createProgress('Installing/updating master CS2 installation')).toMatchObject({
      phase: 'install',
      pct: null,
    });
  });

  test('waiting for a download that is already running', () => {
    expect(
      createProgress(
        'Waiting for the CS2 download that is already running: downloading 41 % (30.1 of 73.4 GB)'
      )
    ).toMatchObject({ phase: 'waiting', stage: 2, pct: 41, totalGb: 73.4 });
  });

  test('the other steps, in order', () => {
    expect(createProgress('Creating CS2 user')).toMatchObject({ phase: 'prepare', stage: 1 });
    expect(createProgress('Setting up shared configuration')).toMatchObject({ phase: 'setup' });
    expect(createProgress('Setting up server-2')).toMatchObject({ phase: 'setup', stage: 2 });
    expect(createProgress('installing Ready Up on the new servers')).toMatchObject({
      phase: 'readyup',
      stage: 3,
    });
    expect(createProgress('starting server-1')).toMatchObject({ phase: 'start', stage: 4 });
  });

  test('nothing yet, or a step this page does not know', () => {
    expect(createProgress(null).phase).toBeNull();
    expect(createProgress('something new in csm').phase).toBeNull();
  });
});
