# Claude Vault Assistant

Run pre-defined claude prompts against your obsidian vault, within obsidan itself.

An Obsidian plugin that lets you define reusable prompt files (`PROMPT-*.md`) and run them against your vault or the currently active note using the Claude Code CLI in headless mode.

## ⚠️ Security & Trust Model — Read This First

**This plugin works by spawning the Claude Code CLI as a local shell process on your machine.** Prompts you write — including ad-hoc prompts, `PROMPT-*.md` files, and your `CLAUDE.md` — are passed to the CLI, which then drives an agentic loop that can read, write, and edit files in your vault (and run other tools you explicitly allow). You are giving an LLM the ability to take actions on your system. Treat that seriously.

Things you should understand before using this plugin:

- **The plugin invokes a real shell process.** On macOS/Linux it spawns through your login shell (`$SHELL -l -c …`) so your normal environment (PATH, API tokens, shell rc files) is in scope. On Windows it invokes the CLI executable directly. Arguments are properly escaped — a prompt cannot inject shell commands at the spawn boundary — but the CLI itself still runs with your full user permissions.
- **Whatever you put in `Allowed tools` is what Claude can do.** The default allowlist (`Read, Grep, Glob, Write, Edit`) is scoped to file I/O inside the vault. If you add `Bash` (or any other tool that executes code), Claude can run arbitrary commands on your machine during a run. Only do this if you understand the consequences.
- **Prompt injection from note content is a real risk.** Claude reads the notes you point it at. If your vault contains untrusted content — clipped web pages, pasted emails, shared notes, anything you didn't author — that content can contain instructions that the model may follow. With a permissive tool allowlist this becomes a path to unintended file edits or command execution. Audit what's in your vault before running broad prompts over it.
- **The `CLI path` setting is not sandboxed.** It's the executable the plugin runs. Don't point it at anything you wouldn't otherwise execute. Leave it as `claude` unless you have a specific reason to change it.
- **`CLAUDE.md` is sent as a system prompt on every run.** Anything in that file shapes the model's behavior across all prompts. Don't paste untrusted content into it.
- **Runs are not sandboxed to the active note.** "Note scope" adds an instruction asking the model to only edit the active note — it's a guideline, not an enforced boundary. With `Write`/`Edit` allowed, the model technically has access to the whole vault.
- **Set a `Max budget (USD)` and `Max turns`.** A prompt that loops or fans out can cost real money. The defaults cap turns at 50; there is no default budget cap.

In short: only run prompts you wrote (or have read), only enable tools you understand, and assume the model will occasionally do something you didn't intend. Review changes (git, file history, Obsidian's file recovery) after broad runs.

## Prerequisites

- [Obsidian](https://obsidian.md/) v1.7.2+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Installation

Now available thru the [Obsidian Community](https://community.obsidian.md/plugins/claude-vault-assistant) site.

## Usage

### Create a CLAUDE.md note in the root of the vault

Create a note in the root of your vault and name it `CLAUDE`. Fill this out with vault conventions claude should know when working within your vault.

An example `CLAUDE.md`:
```markdown
# Personal Assistant - Vault Convetions
You are a personal assistant helping organize and maintain notes in an obsidian vault.

## Vault Structure
- /daily-notes - One note per day (YYY-MM-DD format)
- /projects - Notes related to ongoing projects
- /templates - Obsidian templates for daily notes and other recurring note types
- /people - Notes related to specific individuals

## Conventions
- Always use [[wiki links]] when referencing other notes, projects, or people
- File names should be lowercase with hyphens (e.g., new-project-research.md)
- the `brain-dump.md` note in the root is used for raw brain dumps and unprocessed notes (Claude sorts this into the right folders)
  - when processing brain dumps, break it out into spearate notes in the appropriate folders or append to existing notes if appropriate
- If a note references a person make their name link to their note in `/people`, if they don't have a note, create one and link it.

## Preferences
- Keep notes concise - bullet points over paragraphs
- always include a `## Key Takeaways` section in research notes
- when creating people notes, include: name, role/channel, how they're relevant, and any links to related notes with a short description of their relevance in the note.
```

### Creating prompt files

Create `PROMPT-*.md` files at the root of your vault. Each file defines a reusable prompt. The file name (minus the `PROMPT-` prefix and `.md` extension) becomes the display name in the picker.

**Example**: A prompt to summarize a note and provide bullet list of links at the top of a note, `PROMPT-summarize.md`:

```markdown
You are an Obsidian note summarizer. Your job is to read the provided note and append a concise bulleted summary to the end of it.

## Instructions

1. **Read the full note** before summarizing.
2. **Identify the key points** — focus on facts, decisions, findings, action items, and conclusions.
3. **Write a `## Summary` section** with a bulleted list capturing the essence of the note. Each bullet should be one clear, concise statement.
	1. These should provide quick links to appropriate sections where possible.
4. **Append the Summary section to the end of the note.** Do not modify any existing content.
5. **Do not add information that isn't in the note.** Only distill what is already there.
6. **Use [[wiki links]]** for any referenced people, projects, or notes that aren't already linked.
```

**Example**: A prompt intended to be ran against specific notes, `PROMPT-refine-note.md`:
```markdown
You are an Obsidian note editor. Your job is to refine and improve the provided note while preserving its meaning and intent.

## Instructions

1. **Improve clarity and conciseness** — Tighten language, remove redundancy, and favor bullet points over long paragraphs. Every sentence should earn its place.
2. **Professional tone** — Rewrite informal or rough language to read cleanly and professionally without losing the author's voice.
3. **Structure** — Ensure the note has clear headings, logical flow, and consistent formatting. Add a `## Key Takeaways` section at the end if one doesn't exist.
4. **Add missing [[wiki links]]** — Identify any references to people, projects, tools, concepts, or other notes that should be linked with `[[wiki links]]` but aren't. Add them.
5. **Fix formatting** — Correct any broken markdown, inconsistent list styles, or missing frontmatter.
6. **Do not fabricate content** — Only reorganize and refine what is already there. Do not add new facts, claims, or sections beyond links and Key Takeaways.
```

### Running prompts

There are four ways to run a prompt:

1. **Ribbon icon** — Click the bot icon in the left sidebar to open the prompt picker (vault scope)
2. **Command palette** — Use `Run Claude Prompt (Vault)` to run against the entire vault
3. **Command palette** — Use `Run Claude Prompt (Active Note)` to run scoped to the currently open note
4. **Command palette** — Use `Run ad-hoc Claude prompt` to type a one-off prompt directly without creating a prompt file

After selecting a prompt, Claude's output streams in real time into a sidebar pane. Tool calls (file reads, edits, etc.) are shown as collapsible sections beneath the output, each with a status badge (✓ success, ✗ error) once the result returns.

### Stopping a run

- Click the **Stop** button in the output pane, or
- Use the `Stop Claude` command from the command palette

### Output pane

Use `Open Claude Output` from the command palette to open the output pane at any time. It has two tabs:

- **Output** — Live-streamed markdown output from the current or most recent run, with status indicators (Idle / Running / Complete / Error / Stopped / Limit Reached)
- **History** — A log of past runs showing prompt name, scope, timestamp, duration, status, and cost. Click any entry to review its cached output. Ad-hoc runs include the full prompt text in a collapsible **Prompt** section above the replay; runs from `PROMPT-*.md` files show only the file name. Use the **Clear History** button to remove all entries.

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

## Privacy & Network Usage

This plugin spawns the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) as a local child process. When you run a prompt, the CLI sends your prompt content and relevant vault files to Anthropic's API for processing. No data is sent by the plugin itself — all network communication is handled by the CLI.

- **Account required**: You need an authenticated Anthropic account with billing to use the Claude Code CLI.
- **What is sent**: Prompt file contents, vault file contents read by Claude during a run, and any system prompt from your `CLAUDE.md` file.
- **What is stored locally**: Run history (prompt name, scope, timestamps, cost, and output) is stored in the plugin's data file within your vault's `.obsidian/plugins/` directory.
- **No telemetry**: This plugin does not collect analytics or send any data independently of the CLI.

See [Anthropic's Privacy Policy](https://www.anthropic.com/privacy) for details on how Anthropic handles data sent via the CLI.

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
- **`src/adhoc-prompt-modal.ts`** — Modal for typing ad-hoc prompts
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
