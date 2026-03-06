# Claude Vault Assistant

An Obsidian plugin that lets you define reusable prompt files (`PROMPT-*.md`) and run them against your vault or the currently active note using the Claude Code CLI in headless mode.

## Prerequisites

- [Obsidian](https://obsidian.md/) v0.15.0+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Installation

1. Go to the [latest release](https://github.com/copperbox/obsidian-claude-vault-assistant/releases/latest)
2. Download `main.js`, `manifest.json`, and `styles.css`
3. Create a folder called `claude-vault-assistant` inside your vault's `.obsidian/plugins/` directory
4. Copy the downloaded files into that folder
5. Enable the plugin in Obsidian Settings > Community Plugins

## Usage

### Creating prompt files

Create `PROMPT-*.md` files at the root of your vault. Each file defines a reusable prompt. The file name (minus the `PROMPT-` prefix and `.md` extension) becomes the display name in the picker.

**Example**: A file named `PROMPT-summarize.md` with the contents:

```markdown
Summarize the key points of the provided content into a concise bulleted list.
```

### Running prompts

There are three ways to run a prompt:

1. **Ribbon icon** — Click the bot icon in the left sidebar to open the prompt picker (vault scope)
2. **Command palette** — Use `Run Claude Prompt (Vault)` to run against the entire vault
3. **Command palette** — Use `Run Claude Prompt (Active Note)` to run scoped to the currently open note

After selecting a prompt, Claude's output streams in real time into a sidebar pane. Tool calls (file reads, edits, etc.) are shown as collapsible sections beneath the output.

### Stopping a run

- Click the **Stop** button in the output pane, or
- Use the `Stop Claude` command from the command palette

### Output pane

Use `Open Claude Output` from the command palette to open the output pane at any time. It has two tabs:

- **Output** — Live-streamed markdown output from the current or most recent run, with status indicators (Idle / Running / Complete / Error / Stopped / Limit Reached)
- **History** — A log of past runs showing prompt name, scope, timestamp, duration, status, and cost. Click any entry to review its cached output. Use the **Clear History** button to remove all entries.

### CLAUDE.md support

If a `CLAUDE.md` file exists at the root of your vault, its contents are automatically passed as a system prompt to every run. Use this to set global instructions, conventions, or context that should apply to all prompts.

### Frontmatter overrides

Add YAML frontmatter to any prompt file to override plugin settings on a per-prompt basis. Supported fields:

```markdown
---
model: sonnet
maxTurns: 10
maxBudget: 0.50
allowedTools: [Read, Grep, Glob]
---
Your prompt content here...
```

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Override the Claude model (e.g. `sonnet`, `opus`, `haiku`) |
| `maxTurns` | number | Maximum agentic turns for this prompt |
| `maxBudget` | number | Maximum cost in USD for this prompt |
| `allowedTools` | string[] | Tools Claude is allowed to use (inline `[Read, Grep]` or block YAML list) |

Prompts with overrides display badges in the picker so you can see at a glance which settings differ from defaults.

### Notifications

- An in-app notice appears when a run finishes
- A system notification is sent when Obsidian is not focused, so you can switch away during long runs

### Vault refresh

After Claude edits files, the plugin automatically refreshes modified files in Obsidian so you see changes immediately without needing to reopen or reload.

## Settings

Configure the plugin in Obsidian Settings > Claude Vault Assistant:

| Setting | Default | Description |
|---------|---------|-------------|
| **Allowed tools** | `Read, Grep, Glob, Write, Edit` | Comma-separated list of tools Claude is allowed to use |
| **CLI path** | `claude` | Path to the Claude CLI executable |
| **Max turns** | `50` | Maximum number of agentic turns per run |
| **Max budget (USD)** | No limit | Maximum cost per run in USD |
| **Model override** | CLI default | Override the default Claude model |
| **Max history entries** | `50` | Maximum number of run history entries to keep |

## Architecture

- **`src/main.ts`** — Plugin entry point, registers commands and views
- **`src/settings.ts`** — Plugin settings interface and settings tab
- **`src/claude-runner.ts`** — Spawns Claude CLI as a child process
- **`src/stream-parser.ts`** — Parses streamed JSON output from the CLI
- **`src/output-view.ts`** — Sidebar output pane with markdown rendering and history tab
- **`src/run-history.ts`** — Run history storage, retrieval, and pruning logic
- **`src/prompt-scanner.ts`** — Scans vault root for PROMPT-*.md files
- **`src/frontmatter.ts`** — Parses YAML frontmatter overrides from prompt files
- **`src/prompt-picker.ts`** — Modal for selecting a prompt to run
- **`src/vault-refresher.ts`** — Refreshes modified files after a run

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

## License

MIT
