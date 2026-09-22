# Test Speed Comparison

## Current Performance (Single Worker)

```
249 tests × 3 browsers = 747 test runs
Execution time: ~18-20 minutes
Resource usage: Low (1 Docker stack)
```

## With Test Sharding

### 3 Shards
```
Execution time: ~6-8 minutes
Speedup: ~3x
Resource usage: Medium (3 Docker stacks)
RAM: ~1.5GB
Ports: 3069, 3070, 3071
```

### 5 Shards (Recommended)
```
Execution time: ~4-5 minutes
Speedup: ~4x
Resource usage: Medium-High (5 Docker stacks)
RAM: ~2.5GB
Ports: 3069-3073
```

### 10 Shards
```
Execution time: ~2-3 minutes
Speedup: ~8-10x
Resource usage: High (10 Docker stacks)
RAM: ~5GB
Ports: 3069-3078
```

## Usage Examples

```bash
# Quick test run (3 shards, ~6-8 minutes)
yarn test:sharded:3

# Balanced (5 shards, ~4-5 minutes) - DEFAULT
yarn test:sharded

# Maximum speed (10 shards, ~2-3 minutes)
yarn test:sharded:10

# Custom shard count
./scripts/test-e2e-sharded.sh 7
```

## Choosing Shard Count

**Use 3 shards if:**
- Limited system resources (8GB RAM or less)
- Want faster startup time
- Moderate speedup is acceptable

**Use 5 shards if:**
- Good system resources (8-16GB RAM)
- Want good balance of speed vs resources
- Default recommended option

**Use 10 shards if:**
- High system resources (16GB+ RAM)
- Maximum speed is priority
- Running on CI/CD with good resources

## Performance Notes

- **First run**: May be slower due to Docker image building
- **Subsequent runs**: Faster due to cached images
- **Startup overhead**: Each shard takes ~30-60s to start
- **Total overhead**: ~1-2 minutes for 5 shards
- **Net speedup**: Still significant even with overhead

## Resource Monitoring

Monitor Docker resource usage:
```bash
# Watch Docker stats
docker stats

# Check container count
docker ps | grep matchzy-test-shard | wc -l

# Check port usage
lsof -i :3069-3080
```

