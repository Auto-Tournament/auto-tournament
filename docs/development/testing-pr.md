# Testing Pull Requests

Guide for testing pull requests, specifically for the Customizable Map Pool feature ([PR #11](https://github.com/sivert-io/matchzy-auto-tournament/pull/11), [Issue #10](https://github.com/sivert-io/matchzy-auto-tournament/issues/10)).

---

## Prerequisites

Before testing, ensure you have:

- **Git** installed
- **Node.js 18+** (for local development) OR **Docker & Docker Compose** (for Docker setup)
- **PostgreSQL** (can be run via Docker)
- A GitHub account with access to the repository

---

## Option 1: Local Development Setup

### Step 1: Clone and Checkout PR Branch

```bash
# Clone the repository
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament

# Fetch the PR branch
git fetch origin pull/11/head:pr-11-customizable-map-pool

# Switch to the PR branch
git checkout pr-11-customizable-map-pool
```

**Alternative:** If you already have the repository cloned:

```bash
cd matchzy-auto-tournament

# Fetch latest changes
git fetch origin

# Checkout the PR branch
git checkout feature/10-feature-customizable-map-pool
```

### Step 2: Install Dependencies

```bash
# Install all dependencies (uses Yarn)
yarn install
```

### Step 3: Start PostgreSQL Database

```bash
# Start PostgreSQL using the convenient script
yarn db
```

This will:

- Create a PostgreSQL container if it doesn't exist
- Start the container
- Use default credentials: `postgres/postgres`

**Manual PostgreSQL setup** (if preferred):

```bash
docker run -d --name matchzy-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=matchzy_tournament \
  -p 5432:5432 \
  postgres:16-alpine
```

### Step 4: Set Environment Variables

```bash
# Generate tokens (or use simple passwords for testing)
API_TOKEN=$(openssl rand -base64 12 | tr -d '=+/')
SERVER_TOKEN=$(openssl rand -base64 12 | tr -d '=+/')

# Display tokens (save these!)
echo "Your API_TOKEN (admin password): $API_TOKEN"
echo "Your SERVER_TOKEN (for CS2 servers): $SERVER_TOKEN"

# Export environment variables
export API_TOKEN
export SERVER_TOKEN
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=postgres
export DB_NAME=matchzy_tournament
```

**Note:** For quick testing, you can use simple passwords:

```bash
export API_TOKEN=admin123
export SERVER_TOKEN=server123
```

### Step 5: Start Development Server

```bash
# Start both backend and frontend in development mode
yarn dev
```

This will start:

- **Backend API:** `http://localhost:3000`
- **Frontend:** `http://localhost:5173`

**Access the application at:** `http://localhost:5173`

---

## Option 2: Docker Compose Setup

### Step 1: Clone and Checkout PR Branch

```bash
# Clone the repository
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament

# Fetch and checkout the PR branch
git fetch origin pull/11/head:pr-11-customizable-map-pool
git checkout pr-11-customizable-map-pool
```

### Step 2: Set Environment Variables

```bash
# Generate tokens
API_TOKEN=$(openssl rand -base64 12 | tr -d '=+/')
SERVER_TOKEN=$(openssl rand -base64 12 | tr -d '=+/')

# Display tokens
echo "Your API_TOKEN (admin password): $API_TOKEN"
echo "Your SERVER_TOKEN (for CS2 servers): $SERVER_TOKEN"

# Export them
export API_TOKEN
export SERVER_TOKEN

# Optional: Override database defaults
export DB_USER=postgres
export DB_PASSWORD=postgres
export DB_NAME=matchzy_tournament
```

**Quick testing option:**

```bash
export API_TOKEN=admin123
export SERVER_TOKEN=server123
```

### Step 3: Build and Start with Docker Compose

```bash
# Build and start all services
docker compose -f docker/docker-compose.local.yml up -d --build
```

This will:

- Build the application from source
- Start PostgreSQL
- Start the MatchZy Tournament API
- Serve everything on port **3069**

**Access the application at:** `http://localhost:3069`

### Step 4: View Logs (Optional)

```bash
# View all logs
docker compose -f docker/docker-compose.local.yml logs -f

# View only API logs
docker compose -f docker/docker-compose.local.yml logs -f matchzy-tournament
```

---

## Testing the Map Pool Feature

### 1. Login

1. Navigate to `http://localhost:5173` (local dev) or `http://localhost:3069` (Docker)
2. Click **"Login"** (top right)
3. Enter your `API_TOKEN` (the password you set above)

### 2. Navigate to Maps Page

1. Click **"Maps"** in the sidebar navigation
2. You should see two tabs: **"Maps"** and **"Map Pools"**

### 3. Test Maps Tab

**Add a New Map:**

1. Click **"Add Map"** button
2. Fill in:
   - **Map ID:** `de_testmap` (lowercase, numbers, underscores only)
   - **Display Name:** `Test Map`
3. Optionally upload an image or click **"Fetch from GitHub"**
4. Click **"Create"**
5. Verify the map appears in the list

**Edit a Map:**

1. Click on any map card
2. Click **"Edit"** in the actions modal
3. Change the display name
4. Click **"Update"**
5. Verify changes are saved

**Delete a Map:**

1. Click on a map card
2. Click **"Delete"** in the actions modal
3. Confirm deletion
4. Verify map is removed

### 4. Test Map Pools Tab

**Create a Map Pool:**

1. Switch to **"Map Pools"** tab
2. Click **"Create Map Pool"** button
3. Fill in:
   - **Map Pool Name:** `My Test Pool`
4. Select maps from the autocomplete dropdown
5. Click **"Create"**
6. Verify the pool appears in the list

**Edit a Map Pool:**

1. Click on a map pool card
2. Click **"Edit"** in the actions modal
3. Add or remove maps
4. Click **"Update"**
5. Verify changes are saved

**Delete a Map Pool:**

1. Click on a map pool card
2. Click **"Delete"** in the actions modal
3. Confirm deletion
4. Verify pool is removed

### 5. Test Tournament Integration

**Create a Tournament with Map Pool:**

1. Navigate to **"Tournament"** page
2. Click **"Create Tournament"** or edit existing tournament
3. Fill in tournament details
4. In **Step 3: Map Pool**, you should see:
   - Dropdown with **"Active Duty"** option
   - Any custom pools you created
   - **"Custom"** option
5. Select **"Active Duty"** or a custom pool
6. If selecting **"Custom"**:
   - Select maps from autocomplete
   - Click **"Save Map Pool"** to create a new pool
7. Complete tournament creation
8. Verify map pool is saved with tournament

**Test Map Pool Validation:**

1. Create a tournament with **BO1**, **BO3**, or **BO5** format
2. Select a map pool with ≠ 7 maps
3. Verify warning message appears: _"Map veto requires exactly 7 maps"_
4. Create a pool with exactly 7 maps
5. Verify no warning appears

---

## What to Test

### ✅ Core Functionality

- [ ] Can add new maps with Map ID and display name
- [ ] Can edit map display name and image
- [ ] Can delete maps
- [ ] Can create map pools with multiple maps
- [ ] Can edit map pools (add/remove maps)
- [ ] Can delete map pools
- [ ] Map pools appear in tournament creation dropdown
- [ ] Can select Active Duty pool in tournament
- [ ] Can select custom pools in tournament
- [ ] Can create custom selection during tournament creation
- [ ] Map pool validation works (7 maps required for veto formats)

### ✅ UI/UX

- [ ] Maps page loads correctly
- [ ] Tabs switch between Maps and Map Pools
- [ ] Map cards display correctly (with/without images)
- [ ] Map pool cards show map count and preview chips
- [ ] Modals open and close correctly
- [ ] Form validation works (required fields, Map ID format)
- [ ] Error messages display correctly
- [ ] Success feedback appears after actions

### ✅ Edge Cases

- [ ] Cannot create map with invalid Map ID format (uppercase, special chars)
- [ ] Cannot create map pool without selecting maps
- [ ] Cannot create map pool without name
- [ ] Warning appears when pool has ≠ 7 maps for veto formats
- [ ] Can delete map that's in use (should handle gracefully)
- [ ] Can delete map pool that's in use (should handle gracefully)

---

## Reporting Issues

If you find any bugs or issues while testing:

1. **Check existing issues:** Search [GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues) to see if it's already reported
2. **Create new issue:** If not found, create a new issue with:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Browser/OS information

**Issue Template:**

```markdown
## Bug Report

**Description:**
[Clear description of the issue]

**Steps to Reproduce:**

1. [Step 1]
2. [Step 2]
3. [Step 3]

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happens]

**Environment:**

- OS: [e.g., macOS 14.0]
- Browser: [e.g., Chrome 120]
- Setup: [Local Dev / Docker]
- Branch: `feature/10-feature-customizable-map-pool`

**Screenshots:**
[If applicable]
```

---

## Cleanup

After testing, you can clean up:

**Local Development:**

```bash
# Stop development server (Ctrl+C)
# Stop PostgreSQL
yarn db:stop

# Or remove PostgreSQL container
yarn db:remove
```

**Docker Compose:**

```bash
# Stop and remove containers
docker compose -f docker/docker-compose.local.yml down

# Remove volumes (deletes database data)
docker compose -f docker/docker-compose.local.yml down -v
```

**Switch back to main branch:**

```bash
git checkout main
git branch -D pr-11-customizable-map-pool  # Remove local PR branch
```

---

## Additional Resources

- **[Managing Maps Guide](../guides/managing-maps.md)** - Complete documentation for maps and map pools
- **[First Tournament Guide](../getting-started/first-tournament.md)** - Step-by-step tournament setup
- **[Troubleshooting Guide](../guides/troubleshooting.md)** - Common issues and solutions

---

## Questions?

If you have questions about testing or need help:

- Open a [GitHub Discussion](https://github.com/sivert-io/matchzy-auto-tournament/discussions)
- Comment on [PR #11](https://github.com/sivert-io/matchzy-auto-tournament/pull/11)
- Check the [documentation](https://mat.sivert.io/)

**Thank you for testing! 🎉**
