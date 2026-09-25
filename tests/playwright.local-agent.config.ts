import base from './playwright.config';
// Local-only (not committed): the full Chromium build for headless runs.
export default {
  ...base,
  projects: (base.projects ?? []).map((project) => ({
    ...project,
    use: { ...project.use, launchOptions: { executablePath: '/Users/sivert/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' } },
  })),
};
