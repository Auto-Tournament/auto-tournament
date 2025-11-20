# Contributing to MatchZy Auto Tournament

Thank you for your interest in contributing! This project welcomes contributions from everyone.

## Development Setup

### Prerequisites

- Node.js 18+
- Docker (optional, for full stack testing)
- PostgreSQL (required - can run with Docker for local development)
- A CS2 server with MatchZy plugin (for testing)

### Local Setup

```bash
# Clone the repository
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament

# Install dependencies
yarn install

# Start PostgreSQL for local development
yarn db

# Set environment variables
export API_TOKEN=admin123  # Or any password you want
export SERVER_TOKEN=server123
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=postgres
export DB_NAME=matchzy_tournament

# Start development server
yarn dev
```

??? info "PostgreSQL for Local Development"

    **PostgreSQL is required** for all setups (Docker and local development).

    **Quick Setup with Yarn (recommended):**
    ```bash
    yarn db           # Start PostgreSQL container
    yarn db:stop      # Stop PostgreSQL container
    yarn db:restart   # Restart PostgreSQL container
    yarn db:remove    # Remove PostgreSQL container
    ```

    The `yarn db` command will:
    - Start the container if it already exists but is stopped
    - Create and start a new container if it doesn't exist
    - Do nothing if the container is already running

    **Manual Setup with Docker:**
    ```bash
    docker run -d --name matchzy-postgres \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB=matchzy_tournament \
      -p 5432:5432 \
      postgres:16-alpine
    ```

    Then set environment variables:
    ```bash
    export DB_HOST=localhost
    export DB_PORT=5432
    export DB_USER=postgres
    export DB_PASSWORD=postgres
    export DB_NAME=matchzy_tournament

    # Also set your API_TOKEN (admin password)
    export API_TOKEN=admin123  # Or any password you want
    export SERVER_TOKEN=server123
    ```

**Access:**

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000`
- API Docs: `http://localhost:3000/api-docs`

## Project Structure

```
matchzy-auto-tournament/
├── src/                          # Backend (TypeScript + Express)
│   ├── config/                   # Database, Swagger setup
│   ├── middleware/               # Auth, validation
│   ├── routes/                   # API endpoints
│   ├── services/                 # Business logic
│   │   ├── bracketGenerators/    # Tournament bracket generation
│   │   ├── *BracketGenerator.ts  # Tournament type implementations
│   │   └── matchConfigBuilder.ts # Match configuration builder
│   ├── types/                    # TypeScript type definitions
│   └── utils/                    # Helper functions
├── client/                       # Frontend (React + Material UI)
│   └── src/
│       ├── components/           # Reusable React components
│       ├── pages/                # Page components
│       ├── hooks/                # Custom React hooks
│       ├── types/                # TypeScript types
│       └── brackets-viewer/      # Forked brackets-viewer.js bundle with MatchZy tweaks
├── docs/                         # Documentation (MkDocs)
│   ├── mkdocs.yml               # Docs configuration
│   └── requirements.txt          # Python dependencies for docs
├── docker/                       # Docker configuration
│   ├── Dockerfile               # Multi-stage build
│   ├── docker-compose.yml       # Docker Hub image (pre-built)
│   ├── docker-compose.local.yml # Local build from source
│   └── Caddyfile                # Reverse proxy config
└── scripts/                      # Utility scripts
    ├── release.sh               # Docker Hub release automation
    └── test-docker.sh           # Local Docker testing
```

## Code Guidelines

### Backend (TypeScript)

**File Naming:**

- Services: `camelCaseService.ts` (e.g., `tournamentService.ts`)
- Routes: `kebab-case.ts` (e.g., `team-match.ts`)
- Types: `*.types.ts` (e.g., `tournament.types.ts`)
- Utils: `camelCase.ts` (e.g., `matchProgression.ts`)

**Principles:**

- **DRY**: Don't Repeat Yourself - extract common logic
- **Separation of Concerns**: Routes handle HTTP, services contain business logic
- **Type Safety**: Use proper TypeScript types, avoid `any` and `unknown`
- **File Size**: Keep files under 400 lines - extract if too long

### Frontend (React + TypeScript)

**Component Structure:**

```typescript
// ComponentName.tsx
import { FC } from 'react';

interface ComponentNameProps {
  // Props here
}

export const ComponentName: FC<ComponentNameProps> = ({ prop1, prop2 }) => {
  // Component logic
  return (
    // JSX
  );
};
```

**Best Practices:**

- Use functional components with hooks
- Keep components focused and small
- Extract complex logic to custom hooks
- Use Material UI components consistently

### Code Style

- Use ESLint configuration (run `yarn lint`)
- Format with Prettier
- Use meaningful variable names
- Add comments for complex logic
- Write self-documenting code

## Adding New Features

### Adding a New Tournament Type

See [Architecture Documentation](architecture.md#adding-new-tournament-types) for a complete guide on extending the bracket generation system.

### Adding a New API Endpoint

1. Create route handler in `src/routes/`
2. Add business logic to appropriate service in `src/services/`
3. Define types in `src/types/`
4. Add Swagger documentation (if applicable)
5. Update tests

### Adding New Socket Events

1. Define type in `src/types/socket.types.ts`
2. Add emitter in `src/services/socketService.ts`
3. Add listener in frontend `src/hooks/useWebSocket.ts`

## Pull Request Process

1. **Fork** the repository
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Commit with clear messages**: `git commit -m "Add: new tournament type"`
5. **Push to your fork**: `git push origin feature/amazing-feature`
6. **Open a Pull Request**

### PR Guidelines

- Describe what your PR does and why
- Reference any related issues
- Include screenshots for UI changes
- Ensure the build passes
- Keep PRs focused (one feature per PR)

### Testing Pull Requests

If you want to test a pull request before it's merged:

**Quick Start:**

```bash
# Clone and checkout PR branch
git clone https://github.com/sivert-io/matchzy-auto-tournament.git
cd matchzy-auto-tournament
git fetch origin pull/11/head:pr-11-customizable-map-pool
git checkout pr-11-customizable-map-pool

# Local Development
yarn install
yarn db
export API_TOKEN=admin123
yarn dev
# Access at http://localhost:5173

# OR Docker Compose
export API_TOKEN=admin123
docker compose -f docker/docker-compose.local.yml up -d --build
# Access at http://localhost:3069
```

📖 **[Complete Testing Guide](testing-pr.md)** — Detailed instructions for testing PRs, including setup options, testing checklists, and bug reporting.

## Commit Messages

Use clear, descriptive commit messages:

```
Add: Brief description of addition
Fix: Brief description of fix
Update: Brief description of change
Remove: Brief description of removal
Refactor: Brief description of refactor
```

Examples:

- `Add: Swiss tournament bracket generator`
- `Fix: Match not loading on server allocation`
- `Update: Improve veto UI responsiveness`

## Documentation

When adding features:

- Update relevant documentation in `docs/`
- Add code comments for complex logic
- Update API documentation (Swagger)
- Add examples where helpful

## Getting Help

- **Questions**: [GitHub Discussions](https://github.com/sivert-io/matchzy-auto-tournament/discussions)
- **Issues**: [GitHub Issues](https://github.com/sivert-io/matchzy-auto-tournament/issues)
- **Architecture**: See [Architecture Documentation](architecture.md)

## Code of Conduct

Please be respectful and constructive. We're all here to build something awesome for the CS2 community! 🎮

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
