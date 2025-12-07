# Test Parallelization Guide

## Overview

The test suite can run tests in parallel using **test sharding** - splitting tests across multiple isolated Docker stacks. This significantly speeds up test execution while maintaining isolation.

## Quick Start

```bash
# Run with 5 shards (default)
yarn test:sharded

# Run with 3 shards (faster startup, less parallelization)
yarn test:sharded:3

# Run with 10 shards (more parallelization, more resource usage)
yarn test:sharded:10

# Custom shard count
./scripts/test-e2e-sharded.sh 8
```

## How It Works

### Architecture

1. **Multiple Docker Stacks**: Each shard runs in its own isolated Docker Compose stack
   - Different port: `3069`, `3070`, `3071`, etc.
   - Different database: `matchzy_tournament_shard1`, `matchzy_tournament_shard2`, etc.
   - Different Docker project: `matchzy-test-shard-1`, `matchzy-test-shard-2`, etc.

2. **Playwright Sharding**: Uses Playwright's built-in `--shard=X/Y` feature
   - Splits all tests into Y shards
   - Shard X runs its subset of tests
   - Tests are distributed deterministically

3. **Parallel Execution**: All shards run simultaneously
   - Each shard uses 1 worker (no internal parallelism)
   - But N shards run in parallel = Nx speedup

### Example: 5 Shards

```
Shard 1: Tests 1-50   → Docker stack on port 3069 → Database: matchzy_tournament_shard1
Shard 2: Tests 51-100 → Docker stack on port 3070 → Database: matchzy_tournament_shard2
Shard 3: Tests 101-150 → Docker stack on port 3071 → Database: matchzy_tournament_shard3
Shard 4: Tests 151-200 → Docker stack on port 3072 → Database: matchzy_tournament_shard4
Shard 5: Tests 201-249 → Docker stack on port 3073 → Database: matchzy_tournament_shard5
```

All 5 shards run **simultaneously** in parallel processes.

## Performance

### Before (Single Worker)
- 249 tests × 3 browsers = 747 test runs
- Sequential execution: ~18-20 minutes
- Resource usage: Low (1 Docker stack)

### After (5 Shards)
- 249 tests split into 5 shards × 3 browsers
- Parallel execution: ~4-5 minutes (4x speedup)
- Resource usage: Medium (5 Docker stacks)

### After (10 Shards)
- 249 tests split into 10 shards × 3 browsers
- Parallel execution: ~2-3 minutes (8-10x speedup)
- Resource usage: High (10 Docker stacks)

## Resource Requirements

Each shard requires:
- ~500MB RAM (PostgreSQL + Application)
- 1 CPU core
- Port number (3069, 3070, etc.)

**Recommended shard counts:**
- **3 shards**: Good balance, ~6-8 minutes
- **5 shards**: Default, ~4-5 minutes
- **10 shards**: Fast but high resource usage, ~2-3 minutes

**System requirements:**
- 8GB+ RAM recommended for 5 shards
- 16GB+ RAM recommended for 10 shards
- Ensure Docker has enough resources allocated

## Usage

### Basic Usage

```bash
# Default (5 shards)
yarn test:sharded

# With filters (filters apply to all shards)
yarn test:sharded --grep "@api"
yarn test:sharded --project chromium
```

### Advanced Usage

```bash
# Custom shard count with arguments
./scripts/test-e2e-sharded.sh 8 --grep "@ui" --project chromium

# Pass through any Playwright arguments
./scripts/test-e2e-sharded.sh 5 --reporter=dot --timeout=60000
```

## Output

### Individual Shard Logs
Each shard outputs to: `test-output-shard-{N}.log`

### Individual Reports
Each shard generates: `playwright-report-shard-{N}/`

### Merged Report (if available)
If `@playwright/merge-reports` is installed:
- Merged report: `playwright-report/index.html`
- Combines all shard results

To install merge-reports:
```bash
yarn add -D @playwright/merge-reports
```

## Troubleshooting

### Port Conflicts
If you see port conflicts:
```bash
# Check what's using the ports
lsof -i :3069-3080

# Kill existing test containers
docker ps | grep matchzy-test-shard | awk '{print $1}' | xargs docker kill
```

### Out of Memory
If Docker runs out of memory:
- Reduce shard count: `yarn test:sharded:3`
- Increase Docker Desktop memory limit
- Close other applications

### Shard Startup Failures
If a shard fails to start:
- Check logs: `docker compose -f docker/docker-compose.local.yml -p matchzy-test-shard-N logs`
- Verify port is available
- Check Docker resources

## Comparison: Sharding vs Workers

### Why Not Multiple Workers?

The system uses a single shared database and can't handle concurrent test operations. Multiple workers would cause:
- Database conflicts (duplicate keys, race conditions)
- Test interference (tests modifying shared state)
- Flaky tests

### Why Sharding Works

Each shard has:
- ✅ Isolated database
- ✅ Isolated application instance
- ✅ No shared state
- ✅ Deterministic test distribution

## CI/CD Integration

For CI systems (GitHub Actions, etc.), you can use native sharding:

```yaml
# GitHub Actions example
strategy:
  matrix:
    shard: [1, 2, 3, 4, 5]
steps:
  - run: yarn test:sharded:${{ matrix.shard }}/5
```

Or use CI's parallel job feature with the sharded script.

## Future Improvements

Potential optimizations:
- [ ] Cache Docker images between shards
- [ ] Reuse build artifacts
- [ ] Smart test distribution (group slow tests separately)
- [ ] Automatic shard count based on available resources

