import { Page } from '@playwright/test';
import { signInViaAPI, getApiToken } from './auth';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Storage state helpers for sharing authentication between tests
 */

const STORAGE_STATE_PATH = path.join(__dirname, '../.auth/user.json');

/**
 * Create and save authentication storage state
 * This can be loaded in playwright.config.ts to auto-authenticate all tests
 */
export async function saveAuthStorageState(page: Page): Promise<void> {
  // Sign in
  await signInViaAPI(page);

  // Ensure directory exists
  const dir = path.dirname(STORAGE_STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Save storage state
  await page.context().storageState({ path: STORAGE_STATE_PATH });
}

/**
 * Check if storage state file exists
 */
export function hasAuthStorageState(): boolean {
  return fs.existsSync(STORAGE_STATE_PATH);
}

/**
 * Get path to storage state file
 */
export function getAuthStorageStatePath(): string {
  return STORAGE_STATE_PATH;
}
