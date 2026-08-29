# Test Structure

This directory contains the test suite for MatchZy Auto Tournament.

## Directory Structure

```
tests/
├── helpers/           # Shared test utilities
│   ├── auth.ts       # Authentication + admin impersonation helpers
│   ├── database.ts   # Database management helpers
│   ├── setup.ts      # Test setup helpers (signs in page AND request)
│   ├── teams.ts      # Team creation/management helpers
│   ├── servers.ts    # Server creation/management helpers
│   ├── veto.ts       # Veto API helpers
│   └── vetoUI.ts     # Veto UI helpers
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
- ❌ Each test needs to sign in separately (see "Two cookie jars" below)

#### Two cookie jars: `page` and `request`

Playwright's `page` and the standalone `request` fixture do **not** share cookies.
`page.request` uses the browser context's jar; the `request` fixture has its own.

Almost every helper in `helpers/` drives the API through `request`, so a test that
only calls `ensureSignedIn(page)` will get
`401 Unauthorized - Admin session required` from those helpers.

Use `setupTestContext(page, request)`, which signs in on both:

```typescript
test.beforeEach(async ({ page, request }) => {
  await setupTestContext(page, request);
});
```

If a spec only needs the `request` side, call `signInViaRequest(request)` directly.

#### Acting as a player (veto and other player-only flows)

Veto actions are authorized from the caller's **Steam identity** — a `teamSlug` in
the request body is ignored, and an admin is not a member of either team. Tests use
admin impersonation to act as a real roster member:

```typescript
import { impersonatePlayer, stopImpersonating } from './helpers/auth';

await impersonatePlayer(request, steamId); // admin now acts as this player
// ... perform veto actions ...
await stopImpersonating(request);
```

The veto helpers (`helpers/veto.ts`, `helpers/vetoUI.ts`) do this for you — each
action carries an `actAsSteamId` and impersonation is always cleared afterwards.

Note that the veto board lives on a player's **own** profile page
(`/player/:steamId`), not on the team page.

#### Fake servers

Create test servers with host `0.0.0.0`. The API treats that as a fake server
(canned RCON, always online). Any other host makes the tournament-start preflight
attempt a real RCON `version` call, which fails and blocks the tournament with
`cs2_outdated_servers`. `createTestServer` already uses `FAKE_SERVER_HOST`.

## Helpers

### Authentication

```typescript
import {
  signIn,
  ensureSignedIn,
  signInViaRequest,
  signInAsPlayer,
  impersonatePlayer,
  stopImpersonating,
} from './helpers/auth';

// Sign in the browser page as admin
await signIn(page);

// Ensure the page is signed in (checks first, only signs in if needed)
await ensureSignedIn(page);

// Sign in the standalone `request` context as admin (needed by API helpers)
await signInViaRequest(request);

// Sign in as a normal, non-admin player
await signInAsPlayer(page);

// Act as another player (admin only)
await impersonatePlayer(request, steamId);
await stopImpersonating(request);
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
4. **Use `setupTestContext(page, request)`**: Signs in both cookie jars
5. **Never let a test skip itself**: `if (!visible) test.skip()` hides regressions —
   assert instead, so a missing element fails the run
6. **Keep files small**: Split into logical groups if > 400 lines
7. **Tag tests**: Use tags like `@api`, `@ui`, `@crud` for filtering

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

**A**: No. Each test gets a fresh browser context, and `page` and `request` have
separate cookie jars even within one test. Use `setupTestContext(page, request)`
to sign in on both.

### Q: How do I order tests?

**A**: Use `test.describe.serial()` to run tests sequentially. If one fails, subsequent tests are skipped.

### Q: Do I need to sign in for each test?

**A**: Yes. `ensureSignedIn()` is cheap though — it checks first and only signs in
if needed. Remember to sign in the `request` context too (`signInViaRequest`), or
use `setupTestContext(page, request)` which does both.
