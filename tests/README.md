# Playwright E2E Tests

End-to-end tests for MatchZy Auto Tournament using Playwright.

## Setup

1. Install dependencies:
   ```bash
   yarn install
   ```

2. Install Playwright browsers:
   ```bash
   yarn test:install
   ```

## Running Tests

### Run all tests (recommended - fully automated)
```bash
# Fully automated: spins up Docker Compose with PostgreSQL, runs tests, cleans up
yarn test
```

### Run tests manually (requires server and database running)
```bash
# Make sure PostgreSQL is running: yarn db
# Make sure server is running: yarn start
# Then run tests:
yarn test:manual
```

### Run tests with specific tags
```bash
# Run only authentication tests
yarn test:manual --grep @auth

# Run only teams tests
yarn test:manual --grep @teams

# Run only CRUD tests
yarn test:manual --grep @crud

# Run login tests only
yarn test:manual --grep @login
```

### Run tests in UI mode (interactive debugging)
```bash
# Works with automated setup
yarn test:ui

# Or with manual setup (requires server/db running)
yarn test:manual --ui
```

### View HTML report
```bash
yarn test:report
```

## Test Tags

Tests are organized using tags for easy filtering:

- `@auth` - Authentication tests
- `@login` - Login-specific tests
- `@logout` - Logout tests
- `@teams` - Teams page tests
- `@servers` - Servers page tests
- `@tournament` - Tournament page tests
- `@bracket` - Bracket page tests
- `@matches` - Matches page tests
- `@settings` - Settings page tests
- `@dashboard` - Dashboard page tests
- `@navigation` - Navigation tests
- `@configuration` - Configuration/settings tests
- `@crud` - Create, Read, Update, Delete operations
- `@example` - Example/template tests

## Environment Variables

- `API_TOKEN` - API token for authentication (default: `admin123`)
- `PLAYWRIGHT_BASE_URL` - Base URL for tests (default: `http://localhost:3069`)

## Test Structure

```
tests/
├── auth.spec.ts      # Authentication tests (@auth, @login, @logout)
├── dashboard.spec.ts # Dashboard page tests (@dashboard, @navigation)
├── teams.spec.ts     # Teams page tests (@teams, @crud)
├── servers.spec.ts   # Servers page tests (@servers, @crud)
├── tournament.spec.ts # Tournament page tests (@tournament, @crud)
├── bracket.spec.ts   # Bracket page tests (@bracket, @navigation)
├── matches.spec.ts   # Matches page tests (@matches, @navigation)
├── settings.spec.ts   # Settings page tests (@settings, @configuration)
└── example.spec.ts   # Example/template tests (@example)
```

## Writing New Tests

1. Create a new test file in `tests/` directory
2. Use tags to organize tests: `{ tag: ['@your-tag'] }`
3. Follow the existing test patterns
4. Use Playwright's best practices for selectors (prefer `getByRole`, `getByLabel`, etc.)

Example:
```typescript
import { test, expect } from '@playwright/test';

test.describe('Your Feature', () => {
  test('should do something', { tag: ['@your-tag'] }, async ({ page }) => {
    await page.goto('/your-page');
    // Your test code here
  });
});
```

## HTML Reports

After running tests, view the full HTML report:
```bash
yarn test:report
```

The report includes:
- Test results with screenshots
- Test execution timeline
- Filtering by tags, status, browser
- Detailed error messages and stack traces

