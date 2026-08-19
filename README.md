# Claude Vault Assistant

Run pre-defined claude prompts against your obsidian vault, within obsidan itself.

An Obsidian plugin that lets you define reusable prompt files (`PROMPT-*.md`) and run them against your vault or the currently active note. Running a prompt starts an **interactive chat** (a multi-turn conversation with Claude inside an Obsidian pane) with the prompt auto-submitted as the first message, driving the Claude Code CLI through the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk), with in-pane tool approvals.

## ⚠️ Security & Trust Model — Read This First

**This plugin works by running the Claude Code CLI as a local process on your machine.** Prompts you write — including chat messages, `PROMPT-*.md` files, and your `CLAUDE.md` — are passed to the CLI, which then drives an agentic loop that can read, write, and edit files in your vault (and run other tools you explicitly allow). You are giving an LLM the ability to take actions on your system. Treat that seriously.

Things you should understand before using this plugin:

- **The plugin runs the CLI as a local process.** The Claude Agent SDK launches your configured CLI executable directly (not through a shell). On macOS/Linux the plugin first harvests your login-shell environment (PATH, API tokens, shell rc exports) and passes it to that process so it sees your normal env; on Windows it uses the process environment directly. Your prompt is delivered to the CLI as data, not as a shell argument, but the CLI itself still runs with your full user permissions.
- **Whatever you put in `Allowed tools` is what Claude auto-approves.** The default allowlist (`Read, Grep, Glob, Write, Edit`) is scoped to file I/O inside the vault. If you add `Bash` (or any other tool that executes code), Claude can run arbitrary commands on your machine during a run without prompting. Only do this if you understand the consequences.
- **Tools outside the whitelist require your approval.** Every session auto-approves the `Allowed tools` whitelist. When Claude wants a tool outside it (and the selected permission mode doesn't already decide it), an approval card appears in the conversation offering **Allow once**, **Allow for this chat**, or **Deny**; "Allow for this chat" lasts until the chat closes. Neither ever changes the saved `Allowed tools` whitelist. Approving a code-executing tool (e.g. `Bash`) — or selecting a permissive mode like **Auto** — carries the same risks as adding it to the whitelist -- only approve what you understand.
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

There are three ways to run a prompt:

1. **Ribbon icon** — Click the bot icon in the left sidebar to choose a scope and open the prompt picker
2. **Command palette** — Use `Run Claude Prompt (Vault)` to run against the entire vault
3. **Command palette** — Use `Run Claude Prompt (Active Note)` to run scoped to the currently open note

Running a prompt opens the **chat view** and starts a fresh conversation: the prompt file's frontmatter overrides (model, effort, permission mode, tools, limits) become the session settings — reflected in the dropdowns below the input box — and the prompt body is submitted automatically as the first message. When that first turn finishes you can keep talking: ask follow-ups, refine the result, or steer Claude, all with the prompt's settings still in effect.

Tool calls (file reads, edits, etc.) appear inline as collapsible sections, each with a status badge (✓ success, ✗ error) once the result returns. While a turn is active, an animated "Claude is working" indicator sits at the bottom of the transcript with a live counter of elapsed time and tokens generated so far; when it finishes, a one-line breakdown shows the cost, elapsed time, and total tokens used (e.g. `$0.0123 - 4.5s - 12,345 tokens`).

If Claude requests a tool that isn't on the `Allowed tools` whitelist (and the permission mode doesn't already decide it), an approval card appears in the conversation with **Allow once**, **Allow for this chat**, or **Deny**. An approval applies only to that conversation and never changes your saved whitelist.

### History

Use `Open Claude history` from the command palette to browse past sessions. Every conversation — prompt-launched or started by hand — records one entry showing its name, timestamp, duration, status, and cost, updated after every turn. Click an entry to review its output, and use **Clear history** to remove all entries.

**Resuming a conversation.** Clicking an entry recorded with a session id opens it straight in the chat view — like switching to another chat: the past output renders as context and the stored CLI session reconnects, with Claude retaining the full conversation, so you simply type your next message to continue where you left off. Further turns keep updating the same history entry. Entries recorded before session ids existed open in a read-only replay instead. (Resume needs the CLI's stored session under `~/.claude/projects/`; if it has been cleaned up, the resumed chat reports an error.)

### Interactive chat

Open a multi-turn conversation with Claude inside Obsidian:

1. **Ribbon icon** — Click the chat (message) icon in the left sidebar, or
2. **Command palette** — Use `Open Claude chat`

Type a message and press **Enter** to send (**Shift+Enter** for a newline). Claude's replies render as markdown, and tool calls appear inline as collapsible sections. While Claude is working on a turn, an animated "Claude is working" indicator with a live elapsed-time and token counter sits at the bottom of the transcript; it disappears when the turn ends. After each turn, a one-line breakdown below the reply shows the cost, elapsed time, and tokens used (e.g. `$0.0123 - 4.5s - 12,345 tokens`). The conversation keeps its context across turns -- one Claude process stays alive for the life of the chat.

**Tool approvals.** The chat auto-approves the `Allowed tools` whitelist. When Claude wants a tool that isn't on it (and the permission mode doesn't already decide), an approval card appears in the conversation with three choices:

- **Allow once** — permit this single call; you'll be asked again next time.
- **Allow for this chat** — permit this tool for the rest of the current conversation; forgotten when the chat closes.
- **Deny** — refuse the call and tell Claude so.

These approvals never modify your saved `Allowed tools` whitelist. One-off prompts have the same approval flow, scoped to a single run.

**Choosing the model.** A settings bar below the message box has a model dropdown showing the model that will be used for the next message. It defaults to your `Model override` setting (or "Default (CLI)" when that's empty, letting the CLI choose). Pick a different model (Opus, Sonnet, Haiku, or a custom value from your settings) to switch -- it applies live to the running conversation and is remembered for this chat only; it never changes your saved settings. The dropdown is locked while a turn is in progress.

**Choosing the effort.** Next to it, an effort dropdown sets how much reasoning Claude applies (Default / Low / Medium / High / xHigh / Max), initialized from the `Effort` setting. Because the underlying session process starts with a fixed effort, a change applies when the *next* session starts (use **New chat**); levels a model doesn't support fall back automatically.

**Choosing the permission mode.** The bar's permissions dropdown controls how tool use is approved, initialized from the `Permission mode` setting:

- **Prompt (default)** — anything not on the `Allowed tools` whitelist shows an approval card.
- **Accept edits** — file edits are auto-approved; other non-whitelisted tools still prompt.
- **Plan** — Claude plans without executing tools (read-only).
- **Auto** — Claude decides per action which operations to allow.

Unlike effort, the permission mode switches live: changing it mid-conversation (even mid-turn) applies to the running session immediately. The dangerous `bypassPermissions` mode is deliberately not offered.

**Active-note context.** A context bar sits just above the message box showing the note you currently have open in Obsidian, with a checkbox that is on by default. While it's checked, each message you send is prefixed with a short line naming that note as a `[[wiki link]]` and telling Claude to read it if it's relevant -- so a chat instantly knows what you're looking at without you pasting anything. The reference is cheap (it costs no extra tokens up front; Claude reads the note itself only when it needs to), and it always reflects the note's current on-disk contents. The bar updates as you switch notes, and a small `Context: [[note]]` caption is recorded under each message that included one -- its wiki link is clickable, so you can reopen the referenced note when reviewing the history. Uncheck the box to send a message with no note attached. When no note is open, the bar shows "No note open" and nothing is attached.

**Context-window gauge.** A small ring above the Send button fills clockwise as the conversation consumes the model's context window. It updates live from each assistant message while a turn runs and syncs to the CLI's exact count when the turn ends; hover it for the percentage and token counts. It turns red past 80%, a hint to start a **New chat** soon. The usage is saved with the session's history entry, so resuming a past conversation restores the gauge to where it left off.

**Stopping and resetting.** Use **Stop** in the chat header to interrupt the current turn without ending the conversation. Use **New chat** to discard the conversation and start fresh, and **History** to jump to the session history pane.

**One turn at a time.** Only one turn can be running at once, no matter how it was started. An idle, open chat holds no lock -- it is only held while a turn is actively running. The `Max turns` and `Max budget (USD)` settings apply per chat turn.

### CLAUDE.md support

If a `CLAUDE.md` file exists at the root of your vault, its contents are automatically passed as a system prompt to every run. Use this to set global instructions, conventions, or context that should apply to all prompts.

### Frontmatter overrides

Add YAML frontmatter to any prompt file to override plugin settings on a per-prompt basis. Supported fields:

```markdown
---
model: sonnet
effort: xhigh
permissionMode: acceptEdits
maxTurns: 10
maxBudget: 0.50
allowedTools: [Read, Grep, Glob]
---
Your prompt content here...
```

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Override the Claude model (e.g. `sonnet`, `opus`, `haiku`) |
| `effort` | string | Reasoning effort for this prompt's session: `low`, `medium`, `high`, `xhigh`, or `max` |
| `permissionMode` | string | Permission mode for this prompt's session: `default`, `acceptEdits`, `plan`, or `auto` (`bypassPermissions` is rejected) |
| `maxTurns` | number | Maximum agentic turns for this prompt |
| `maxBudget` | number | Maximum cost in USD for this prompt |
| `allowedTools` | string[] | Tools Claude is allowed to use (inline `[Read, Grep]` or block YAML list) |

Prompts with overrides display badges in the picker so you can see at a glance which settings differ from defaults.

### Notifications

- An in-app notice appears when a prompt-launched run finishes its auto-submitted first turn
- A system notification is sent when Obsidian is not focused, so you can switch away during long runs

### Vault refresh

After Claude edits files, the plugin automatically refreshes modified files in Obsidian at the end of each turn so you see changes immediately without needing to reopen or reload.

## Privacy & Network Usage

This plugin runs the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) as a local child process. Prompt runs and the interactive chat drive the CLI through the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk), which launches your installed CLI (so it uses your existing authentication). When you run a prompt or send a chat message, the CLI sends your content and relevant vault files to Anthropic's API for processing. No data is sent by the plugin itself — all network communication is handled by the CLI.

- **Account required**: You need an authenticated Anthropic account with billing to use the Claude Code CLI.
- **What is sent**: Prompt file contents, chat messages, vault file contents read by Claude during a run, and any system prompt from your `CLAUDE.md` file.
- **What is stored locally**: Session history (name, timestamps, cost, assistant output, and the CLI session id) is stored in the plugin's data file within your vault's `.obsidian/plugins/` directory. The CLI itself also persists conversation transcripts under `~/.claude/projects/` — that's what makes resuming a conversation possible; clear them with the CLI's own tooling if you don't want them kept.
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
| **Effort** | Default | Default reasoning effort for new sessions (`low` / `medium` / `high` / `xhigh` / `max`) |
| **Permission mode** | Prompt | Default permission mode for new sessions (prompt / accept edits / plan / auto) |
| **Max history entries** | `50` | Maximum number of run history entries to keep |

## Architecture

- **`src/main.ts`** — Plugin entry point, registers commands and views
- **`src/settings.ts`** — Plugin settings interface and settings tab
- **`src/chat-session.ts`** — Claude Agent SDK driver for the interactive chat: builds options (model, effort, permission mode, resume), streams SDK messages, and bridges tool approvals
- **`src/history-view.ts`** — Sidebar history pane: session list, entry detail replay, and the resume-in-chat action
- **`src/run-history.ts`** — Session history storage, upsert, and pruning logic
- **`src/prompt-scanner.ts`** — Scans vault root for PROMPT-*.md files
- **`src/frontmatter.ts`** — Parses YAML frontmatter overrides from prompt files
- **`src/prompt-picker.ts`** — Modal for selecting a prompt to run
- **`src/vault-refresher.ts`** — Refreshes modified files after each turn
- **`src/chat-view.ts`** — Sidebar chat pane: transcript, input box, session-control dropdowns (model/effort/permissions), active-note context bar, permission cards, prompt launches, and history recording/resume
- **`src/chat-context.ts`** — Pure helpers that turn the active note into a reference-only context preamble ([[wiki links]]) prepended to a chat turn
- **`src/permission-card.ts`** — Tool-approval card rendering shown in the chat transcript
- **`src/permission-types.ts`** — Shared permission contract (decision and request types)
- **`src/run-types.ts`** — Shared `RunScope` type (vault vs active note)
- **`src/system-prompt.ts`** — The Obsidian system prompt appended on every run
- **`src/env-resolver.ts`** — Harvests the login-shell environment so the SDK-launched CLI sees your normal PATH and API tokens
- **`src/electron-compat.ts`** — Electron renderer shim so the Agent SDK runs inside Obsidian
- **`src/activity-lock.ts`** — Shared gate so two turns never run at the same time
- **`src/tool-render.ts`** — Tool-call rendering shown in the chat transcript
- **`src/working-indicator.ts`** — Animated "Claude is working" indicator with a live elapsed-time/token counter, shown while a turn is in flight
- **`src/format.ts`** — Shared formatting for the cost/time/token breakdown and live token counts

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
