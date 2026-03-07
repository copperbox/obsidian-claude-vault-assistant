import { type ChildProcess, spawn } from "child_process";
import type { PluginSettings } from "./settings";

export type RunScope = "vault" | "note";

export interface RunOptions {
	vaultPath: string;
	promptContent: string;
	settings: PluginSettings;
	scope: RunScope;
	activeNotePath?: string;
	systemPrompt?: string;
}

export class ClaudeRunnerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ClaudeRunnerError";
	}
}

export function buildPrompt(options: RunOptions): string {
	const parts: string[] = [];

	if (options.scope === "note") {
		if (!options.activeNotePath) {
			throw new ClaudeRunnerError(
				"Note scope requires an active note path"
			);
		}
		parts.push(`Only make edits to this note: ${options.activeNotePath}`);
	}

	parts.push(options.promptContent);
	return parts.join("\n");
}

const PLUGIN_SYSTEM_PROMPT = [
	"You are operating inside an Obsidian vault.",
	"When referencing notes, ALWAYS use Obsidian [[wiki links]] (e.g. [[my-note]]), never plain file paths like path/to/my-note.md.",
	"When creating or editing notes, use Obsidian-flavored Markdown: [[wiki links]], #tags, and standard frontmatter.",
].join(" ");

export function buildArgs(options: RunOptions): string[] {
	const args: string[] = [
		"-p",
		buildPrompt(options),
		"--output-format",
		"stream-json",
		"--verbose",
		"--no-session-persistence",
		"--append-system-prompt",
		PLUGIN_SYSTEM_PROMPT,
	];

	if (options.settings.allowedTools.length > 0) {
		args.push("--allowedTools");
		args.push(...options.settings.allowedTools);
	}

	if (options.settings.maxTurns > 0) {
		args.push("--max-turns", String(options.settings.maxTurns));
	}

	if (options.settings.maxBudget !== null && options.settings.maxBudget > 0) {
		args.push("--max-budget-usd", String(options.settings.maxBudget));
	}

	if (options.settings.modelOverride) {
		args.push("--model", options.settings.modelOverride);
	}

	if (options.systemPrompt) {
		args.push("--append-system-prompt", options.systemPrompt);
	}

	return args;
}

/**
 * Escape a string for safe inclusion in a single-quoted shell argument.
 * Wraps in single quotes and escapes any embedded single quotes.
 */
export function shellEscape(arg: string): string {
	return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Build the spawn command and args for the current platform.
 *
 * On macOS/Linux, GUI apps (Electron/Obsidian) don't inherit the user's
 * shell environment. We spawn through a login shell (`$SHELL -l -c ...`)
 * so that ~/.bash_profile, ~/.zshrc, etc. are sourced — picking up PATH,
 * ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, and any other env vars.
 *
 * On Windows, the full system PATH is already available, so we spawn
 * the CLI directly.
 */
export function buildSpawnCommand(
	cliPath: string,
	args: string[]
): { command: string; spawnArgs: string[] } {
	if (process.platform === "win32") {
		return { command: cliPath, spawnArgs: args };
	}

	const userShell = process.env.SHELL || "/bin/bash";
	const escapedCmd = [cliPath, ...args].map(shellEscape).join(" ");
	return {
		command: userShell,
		spawnArgs: ["-l", "-c", escapedCmd],
	};
}

export class ClaudeRunner {
	private activeProcess: ChildProcess | null = null;

	get isRunning(): boolean {
		return this.activeProcess !== null;
	}

	run(options: RunOptions): ChildProcess {
		if (this.activeProcess) {
			throw new ClaudeRunnerError(
				"A Claude run is already active. Stop it before starting a new one."
			);
		}

		const args = buildArgs(options);
		const { command, spawnArgs } = buildSpawnCommand(
			options.settings.cliPath,
			args
		);
		const child = spawn(command, spawnArgs, {
			cwd: options.vaultPath,
			stdio: ["ignore", "pipe", "pipe"],
		});

		this.activeProcess = child;

		child.on("close", () => {
			this.activeProcess = null;
		});

		child.on("error", (err: NodeJS.ErrnoException) => {
			this.activeProcess = null;
			if (err.code === "ENOENT") {
				child.emit(
					"runner-error",
					new ClaudeRunnerError(
						`Claude CLI not found at "${options.settings.cliPath}". ` +
							"Ensure the Claude CLI is installed and the path is correct in settings."
					)
				);
			}
		});

		return child;
	}

	stop(): void {
		if (this.activeProcess) {
			this.activeProcess.kill();
			this.activeProcess = null;
		}
	}
}
