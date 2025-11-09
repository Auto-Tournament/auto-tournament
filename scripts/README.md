# Utility Scripts

Helper scripts for development and deployment.

## Scripts

### `release.sh`

Automated Docker release script for publishing to Docker Hub.

**Usage:**

```bash
./scripts/release.sh
```

**What it does:**

1. Verifies Docker is running
2. Checks Docker Hub login
3. Builds the image
4. Tests the image (can be skipped)
5. Pushes to Docker Hub with version tag and `:latest`

**Requirements:**

- Docker installed and running
- Logged in to Docker Hub: `docker login`

### `test-docker.sh`

Quick test script for debugging Docker builds locally.

**Usage:**

```bash
./scripts/test-docker.sh
```

**What it does:**

1. Builds test image
2. Starts container
3. Shows logs
4. Cleans up

Use this to debug container startup issues before releasing.

## Environment Variables

### For `release.sh`

- `DOCKER_USERNAME` - Your Docker Hub username (default: `sivertio`)

```bash
export DOCKER_USERNAME=your-username
./scripts/release.sh
```

Or edit the script to change the default.

