# Test Structure

This directory contains the test suite for MatchZy Auto Tournament.

## Directory Structure

```
tests/
├── helpers/           # Shared test utilities
│   ├── auth.ts       # Authentication helpers
│   ├── database.ts   # Database management helpers
│   ├── setup.ts      # Test setup helpers
│   ├── teams.ts      # Team creation/management helpers
│   ├── servers.ts    # Server creation/management helpers
│   ├── fixtures.ts   # Playwright fixtures
│   └── storage-state.ts # Storage state helpers
├── api/              # API tests (no UI interaction)
│   └── servers.spec.ts
├── ui/               # UI tests (browser interaction)
│   └── servers.spec.ts
├── setup.spec.ts     # Global setup (runs first)
└── README.md         # This file
```

## Test Organization

### Separation by Type

- **API Tests** (`tests/api/`): Test backend functionality via API calls
- **UI Tests** (`tests/ui/`): Test frontend functionality via browser interaction

### File Size Guidelines

- **Maximum 300-400 lines per test file**
- Split large test suites into logical groups
- Use helpers to avoid code duplication

### Test Ordering and Dependencies

#### Serial Tests (`test.describe.serial()`)

Tests run **sequentially** in order:

```typescript
test.describe.serial('My Tests', () => {
  test('first test', async ({ page }) => {
    // This runs first
  });

  test('second test', async ({ page }) => {
    // This runs second, only if first passes
  });
});
```

**Important**: Each test gets a **fresh browser context**, so:

- ✅ Tests run in order
- ✅ If one fails, subsequent tests are skipped
- ❌ localStorage/session does NOT persist between tests
- ❌ Each test needs to sign in separately (or use storage state)

#### Sharing Authentication State

**Option 1: Use `ensureSignedIn()` helper** (Recommended for most cases)

```typescript
test('my test', async ({ page }) => {
  await ensureSignedIn(page); // Checks first, only signs in if needed
  // Now authenticated
});
```

**Option 2: Use Storage State** (For all tests in a file)

```typescript
// In playwright.config.ts
use: {
  storageState: 'tests/.auth/user.json', // Auto-authenticates all tests
}
```

**Option 3: Use Fixtures** (For reusable authenticated page)

```typescript
import { test } from './helpers/fixtures';

test('my test', async ({ authenticatedPage }) => {
  // authenticatedPage is already signed in
});
```

## Helpers

### Authentication

```typescript
import { signIn, ensureSignedIn, getAuthHeader } from './helpers/auth';

// Sign in via UI
await signIn(page);

// Sign in via API (faster)
await signInViaAPI(page);

// Ensure signed in (checks first, only signs in if needed)
await ensureSignedIn(page);

// Get auth header for API requests
const headers = getAuthHeader();
```

### Database

```typescript
import { wipeDatabase, wipeDatabaseAuto } from './helpers/database';

// Wipe via API
await wipeDatabase(request);

// Wipe via UI (fallback)
await wipeDatabaseViaUI(page);

// Auto (tries API, falls back to UI)
await wipeDatabaseAuto(page, request);
```

### Teams

```typescript
import { createTeam, createTestTeams, deleteTeam } from './helpers/teams';

// Create single team
const team = await createTeam(request, {
  id: 'team-1',
  name: 'Team 1',
  players: [...],
});

// Create two test teams
const [team1, team2] = await createTestTeams(request, 'prefix');
```

### Servers

```typescript
import { createTestServer, deleteServer } from './helpers/servers';

// Create test server
const server = await createTestServer(request, 'prefix');

// Delete server
await deleteServer(request, server.id);
```

## Test Structure Example

```typescript
import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { ensureSignedIn } from '../helpers/auth';
import { createTestServer, deleteServer } from '../helpers/servers';

test.describe.serial('Server Tests', () => {
  let context: Awaited<ReturnType<typeof setupTestContext>>;

  test.beforeAll(async ({ page, request }) => {
    context = await setupTestContext(page, request);
  });

  test(
    'should create and delete server',
    {
      tag: ['@api', '@servers'],
    },
    async ({ page, request }) => {
      // Ensure signed in (checks first, only signs in if needed)
      await ensureSignedIn(page);

      // Create
      const server = await createTestServer(request);
      expect(server).toBeTruthy();

      // Delete
      const deleted = await deleteServer(request, server!.id);
      expect(deleted).toBe(true);
    }
  );
});
```

## Best Practices

1. **Merge related operations**: Create + delete in one test
2. **Use helpers**: Don't repeat setup code
3. **Use `test.describe.serial()`**: For tests that depend on each other
4. **Use `ensureSignedIn()`**: Instead of signing in every time
5. **Keep files small**: Split into logical groups if > 400 lines
6. **Tag tests**: Use tags like `@api`, `@ui`, `@crud` for filtering

## Running Tests

### Quick Commands

```bash
# Run all tests (with Docker Compose)
yarn test

# Run all tests in UI mode (interactive)
yarn test:ui

# Run only API tests (direct, no Docker)
yarn test:api

# Run only UI tests (direct, no Docker)
yarn test:ui:manual

# Run API tests in UI mode
yarn test:api:manual

# Run only veto tests
yarn test:veto

# Run only CS Major format tests
yarn test:cs-major
```

### Advanced Usage

```bash
# Run specific test file
yarn test:manual tests/api/veto.spec.ts

# Run tests matching a tag
yarn test:manual --grep "@api"
yarn test:manual --grep "@ui"
yarn test:manual --grep "@veto"

# Run tests in a specific directory
yarn test:manual tests/api
yarn test:manual tests/ui

# Run with specific browser
yarn test:manual --project=chromium
yarn test:manual --project=firefox

# Run in headed mode (see browser)
yarn test:manual --headed

# Run with debug mode
yarn test:manual --debug
```

### Using Docker Compose (Recommended)

The `yarn test` command uses Docker Compose to:
1. Start PostgreSQL
2. Build and start the application
3. Run all tests
4. Clean up on exit

```bash
# Full test suite with Docker
yarn test

# With UI mode
yarn test:ui

# With filters
yarn test --grep "@api"
yarn test --grep "@veto"
```

### Direct Playwright (Development)

For faster iteration during development:

```bash
# Make sure app is running first (yarn dev)
yarn test:manual

# Or run specific suites
yarn test:api
yarn test:ui:manual
```

## Test Tags

- `@setup` - Setup/teardown tests
- `@api` - API tests
- `@ui` - UI tests
- `@crud` - Create/Read/Update/Delete tests
- `@veto` - Veto-related tests
- `@cs-major` - CS Major format tests
- `@auth` - Authentication tests

## FAQ

### Q: Do tests share authentication state?

**A**: No, by default each test gets a fresh browser context. Use:

- `ensureSignedIn()` helper (checks first, only signs in if needed)
- Storage state (auto-authenticates all tests)
- Fixtures (reusable authenticated page)

### Q: How do I order tests?

**A**: Use `test.describe.serial()` to run tests sequentially. If one fails, subsequent tests are skipped.

### Q: Do I need to sign in for each test?

**A**: Yes, unless you use storage state or fixtures. But `ensureSignedIn()` is smart - it checks first and only signs in if needed.
