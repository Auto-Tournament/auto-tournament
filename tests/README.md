# Playwright E2E Tests

End-to-end tests for MatchZy Auto Tournament using Playwright.

## Setup

1. Install dependencies:
   ```bash
   yarn install
   ```

2. Install Playwright browsers:
   ```bash
   yarn test:e2e:install
   ```

## Running Tests

### Run all tests
```bash
yarn test:e2e
```

### Run tests with specific tags
```bash
# Run only authentication tests
yarn test:e2e --grep @auth

# Run only teams tests
yarn test:e2e --grep @teams

# Run only CRUD tests
yarn test:e2e --grep @crud

# Run login tests only
yarn test:e2e --grep @login
```

### Run tests in UI mode (interactive)
```bash
yarn test:e2e:ui
```

### View HTML report
```bash
yarn test:e2e:report
```

## Test Tags

Tests are organized using tags for easy filtering:

- `@auth` - Authentication tests
- `@login` - Login-specific tests
- `@logout` - Logout tests
- `@teams` - Teams page tests
- `@servers` - Servers page tests
- `@crud` - Create, Read, Update, Delete operations
- `@example` - Example/template tests

## Environment Variables

- `API_TOKEN` - API token for authentication (default: `admin123`)
- `PLAYWRIGHT_BASE_URL` - Base URL for tests (default: `http://localhost:3069`)

## Test Structure

```
tests/
├── auth.spec.ts      # Authentication tests (@auth, @login, @logout)
├── teams.spec.ts     # Teams page tests (@teams, @crud)
├── servers.spec.ts    # Servers page tests (@servers, @crud)
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
yarn test:e2e:report
```

The report includes:
- Test results with screenshots
- Test execution timeline
- Filtering by tags, status, browser
- Detailed error messages and stack traces

