# Contributing to MatchZy Auto Tournament

First off, thank you for considering contributing to MatchZy Auto Tournament! 🎉

## 🚀 Quick Start

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/matchzy-auto-tournament.git`
3. Create a new branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test your changes locally
6. Commit your changes: `git commit -m "Add: your feature description"`
7. Push to your fork: `git push origin feature/your-feature-name`
8. Open a Pull Request

## 💻 Development Setup

### Prerequisites

- Bun 1.0+ or Node.js 18+
- Docker (optional, for testing deployment)

### Installation

```bash
# Install dependencies
bun install

# Copy environment file
cp .env.example .env

# Start development server
bun run dev
```

## 📋 Development Guidelines

### Code Style

- Use TypeScript for all new code
- Follow the existing code structure
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused

### Commit Messages

Use clear and descriptive commit messages:

- `Add: new feature description`
- `Fix: bug description`
- `Update: what was updated`
- `Refactor: what was refactored`
- `Docs: documentation changes`

### Testing

Before submitting a PR:

1. Test your changes locally
2. Ensure no linter errors: `bun run build`
3. Test with Docker if deployment-related: `docker-compose up --build`

## 🐛 Reporting Bugs

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, runtime version, etc.)
- Relevant logs or screenshots

## 💡 Suggesting Features

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md) and include:

- Clear description of the feature
- Why it's needed
- How it should work
- Use cases

## 📝 Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive criticism
- Help others learn and grow

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Personal or political attacks
- Publishing others' private information

## 🎯 Priority Areas

We especially welcome contributions in these areas:

- [ ] Tournament bracket generation
- [ ] Match scheduling system
- [ ] Map veto functionality
- [ ] Web dashboard UI
- [ ] Discord bot integration
- [ ] Documentation improvements
- [ ] Test coverage
- [ ] Performance optimizations

## 📚 Resources

- [API Documentation](http://localhost:3000/api-docs) (when running locally)
- [MatchZy Plugin Documentation](https://shobhit-pathak.github.io/MatchZy/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

## ❓ Questions?

- Open a [Question issue](.github/ISSUE_TEMPLATE/question.md)
- Check existing issues for similar questions

Thank you for contributing! 🙏
