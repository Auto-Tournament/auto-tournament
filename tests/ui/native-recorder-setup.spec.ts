import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

test(
  'headless frame-by-frame setup keeps the existing recorder choices',
  { tag: ['@ui'] },
  async ({ page }) => {
    await ensureSignedIn(page);
    await page.route('**/api/game/cs2/recorder-keys', (route) =>
      route.fulfill({
        json:
          route.request().method() === 'POST' ? { token: 'native-ui-test-token' } : { keys: [] },
      })
    );
    await page.goto('/manage/highlights?tab=cs2&sub=recorders');
    await page.getByTestId('recorder-add').click();
    const dialog = page.getByRole('dialog');
    const pc = dialog.getByTestId('recorder-add-pc');
    const server = dialog.getByTestId('recorder-add-server');
    const native = dialog.getByRole('tab', {
      name: 'Server (headless - frame by frame)',
      exact: true,
    });
    await expect(pc).toBeVisible();
    await expect(server).toBeVisible();
    await native.click();
    await dialog.getByTestId('recorder-make-key').click();
    const command = dialog.getByTestId('recorder-command');
    await expect(command).toContainText('native.compose.yml up -d --build');
    await expect(command).toContainText('AT_WORKER_TOKEN=native-ui-test-token');
    await expect(dialog.getByTestId('recorder-native-start')).toContainText(
      'docker exec --user abc'
    );
    await expect(dialog.getByText(/initial account sign-in/)).toBeVisible();

    await pc.click();
    await expect(command).toContainText('docker run -d --name at-recorder');
    await expect(dialog.getByTestId('recorder-native-start')).not.toBeVisible();
    await server.click();
    await expect(command).toContainText('/recorder/setup-host.sh');
    await expect(command).toContainText('/recorder/start-recorder.sh');
  }
);
