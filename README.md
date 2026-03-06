# Claude Vault Assistant

An Obsidian plugin that lets users define reusable prompt files (`PROMPT-*.md`) and run them against their vault or the currently active note using Claude Code CLI in headless mode.

## Prerequisites

- [Obsidian](https://obsidian.md/) v0.15.0+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Development

### Setup

```bash
npm install
```

### Build

```bash
# Development (watch mode)
npm run dev

# Production build
npm run build
```

### Test

```bash
# Run tests
npm test

# Watch mode
npm run test:watch
```

### Install in Obsidian (development)

1. Run `npm run build` to produce `main.js`
2. Copy `main.js`, `manifest.json`, and `styles.css` (if present) into your vault's `.obsidian/plugins/claude-vault-assistant/` directory
3. Enable the plugin in Obsidian Settings > Community Plugins

## Usage

> **Note**: This plugin is under active development. Usage instructions will be added as features are implemented.

Create `PROMPT-*.md` files at the root of your vault. Each file defines a reusable prompt that can be run against your vault or the active note via the command palette.

## Architecture

- **`src/main.ts`** — Plugin entry point, registers commands and views
- **`src/__mocks__/obsidian.ts`** — Mock of Obsidian API for unit tests

## License

MIT
