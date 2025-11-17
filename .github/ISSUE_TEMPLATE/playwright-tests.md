---
name: Playwright E2E Tests
about: Add end-to-end testing with Playwright
title: '[FEATURE] Add Playwright E2E Tests'
labels: ['enhancement', 'testing', 'playwright']
assignees: ''
---

## Overview

Add comprehensive end-to-end testing using Playwright to ensure the application works correctly across different browsers and scenarios.

## Goals

- Set up Playwright testing framework
- Write tests for critical user flows
- Ensure tests can be run locally and in CI/CD
- Use tags for test organization and filtering
- Generate HTML reports for test results

## Test Coverage

### Authentication Tests (`@auth`, `@login`, `@logout`)
- [x] Display login page when not authenticated
- [x] Redirect to login when accessing protected route
- [x] Login with valid API token
- [x] Show error with invalid API token
- [x] Logout successfully
- [x] Persist login after page reload

### Teams Page Tests (`@teams`, `@crud`)
- [x] Navigate to teams page
- [x] Display teams page content
- [x] Open create team modal
- [x] Create a new team
- [x] Display empty state when no teams exist
- [x] Edit an existing team

### Servers Page Tests (`@servers`, `@crud`)
- [x] Navigate to servers page
- [x] Display servers page content
- [x] Open create server modal
- [x] Create a new server
- [x] Display empty state when no servers exist

### Future Tests
- [ ] Tournament creation and management (`@tournament`)
- [ ] Bracket generation (`@bracket`)
- [ ] Match management (`@matches`)
- [ ] Settings page (`@settings`)
- [ ] Admin tools (`@admin`)

## Technical Details

### Playwright Configuration
- **Reporter**: HTML report (full, not basic)
- **Browsers**: Chromium, Firefox, WebKit
- **Tags**: Used for filtering tests (`@auth`, `@teams`, `@servers`, `@crud`, etc.)
- **Base URL**: Configurable via `PLAYWRIGHT_BASE_URL` environment variable (default: `http://localhost:3069`)

### Test Structure
```
tests/
├── auth.spec.ts      # Authentication tests
├── teams.spec.ts     # Teams page tests
├── servers.spec.ts   # Servers page tests
└── example.spec.ts   # Example/template tests
```

### Running Tests

```bash
# Run all tests
yarn test:e2e

# Run tests with specific tags
yarn test:e2e --grep @auth
yarn test:e2e --grep @teams
yarn test:e2e --grep @crud

# Run tests in UI mode
yarn test:e2e:ui

# Generate HTML report
yarn test:e2e:report
```

### Environment Variables

- `API_TOKEN`: API token for authentication (default: `admin123`)
- `PLAYWRIGHT_BASE_URL`: Base URL for tests (default: `http://localhost:3069`)

## Acceptance Criteria

- [x] Playwright is installed and configured
- [x] Test files are created with proper tags
- [x] HTML reporter is configured (full report, not basic)
- [x] Tests can be filtered by tags
- [x] Tests run successfully locally
- [ ] Tests can run in CI/CD pipeline
- [ ] Documentation is updated with testing instructions

## Related

- Part of PostgreSQL support feature branch
- Will be merged into `postgresql-support` branch after merging with `main`

