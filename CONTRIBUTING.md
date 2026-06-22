# Contributing

## Prerequisites

- Node.js >= 18
- pnpm >= 9

## Setup

```bash
pnpm install
pnpm build
```

## Development

```bash
# Type-check all packages
pnpm typecheck

# Run all tests
pnpm test

# Run end-to-end pipeline validation
node test-pipeline.js
```

## Project Structure

See `AGENTS.md` for workspace layout and entry points.

## Pull Request Process

1. Ensure all tests pass (`pnpm test && node test-pipeline.js`)
2. Update `CHANGELOG.md` with your changes
3. Add or update tests as needed
4. Keep changes focused — one feature/fix per PR
