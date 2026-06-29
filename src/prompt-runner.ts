import type { PluginSettings } from "./settings";
import type { RunScope } from "./run-types";
import type { PermissionDecision, RequestPermission } from "./permission-types";
import {
	ChatSession,
	type ChatSessionConfig,
	type ChatResult,
	type ChatToolResult,
	type ChatToolUse,
} from "./chat-session";

export type PromptRunStatus = "success" | "limit" | "error" | "stopped";
export type PromptRunLimit = "max_turns" | "budget";

export interface PromptRunOptions {
	vaultPath: string;
	settings: PluginSettings;
	scope: RunScope;
	promptBody: string;
	activeNotePath?: string;
	/** Appended to the system prompt after PLUGIN_SYSTEM_PROMPT (e.g. vault CLAUDE.md). */
	extraSystemPrompt?: string;
	/** Prompts the user for non-whitelisted tools; defaults to auto-deny. */
	requestPermission?: RequestPermission;
}

export interface PromptRunCallbacks {
	onSystemInit?: (info: { model?: string; tools?: string[] }) => void;
	onAssistantText: (text: string) => void;
	onToolUse: (tool: ChatToolUse) => void;
	onToolResult: (result: ChatToolResult) => void;
	/** Non-terminal cost/tokens/duration meta from the SDK result. */
	onResult: (result: ChatResult) => void;
	onError: (message: string) => void;
	/** Terminal; fires exactly once when the run settles. */
	onComplete: (outcome: PromptRunOutcome) => void;
}

export interface PromptRunOutcome {
	status: PromptRunStatus;
	limit?: PromptRunLimit;
	costUsd?: number;
	tokens?: number;
	durationMs?: number;
}

export interface PromptRunnerDeps {
	/** Injectable for tests; defaults to constructing a real ChatSession. */
	createSession?: (config: ChatSessionConfig) => ChatSession;
}

/**
 * Build the first (and only) user message for a one-off run. Note scope restricts
 * edits to the active note by prepending an instruction. Pure -- unit tested.
 */
export function buildPromptText(
	scope: RunScope,
	promptBody: string,
	activeNotePath?: string
): string {
	if (scope === "note") {
		if (!activeNotePath) {
			throw new Error("Note scope requires an active note path");
		}
		return `Only make edits to this note: ${activeNotePath}\n${promptBody}`;
	}
	return promptBody;
}

function errToString(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Drives a single-turn, non-interactive prompt run on top of the Agent SDK
 * (via ChatSession): start the session, send one message, consume until the
 * result, then dispose. Replaces the old child_process-spawning ClaudeRunner.
 */
export class PromptRunner {
	private readonly deps: PromptRunnerDeps;
	private session: ChatSession | null = null;
	private running = false;
	private finished = false;
	private stopped = false;
	private errorSeen = false;
	private lastResult: ChatResult | null = null;
	private startTime = 0;

	constructor(deps: PromptRunnerDeps = {}) {
		this.deps = deps;
	}

	get isRunning(): boolean {
		return this.running;
	}

	async run(
		options: PromptRunOptions,
		callbacks: PromptRunCallbacks
	): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.finished = false;
		this.stopped = false;
		this.errorSeen = false;
		this.lastResult = null;
		this.startTime = Date.now();

		let promptText: string;
		try {
			promptText = buildPromptText(
				options.scope,
				options.promptBody,
				options.activeNotePath
			);
		} catch (err) {
			this.errorSeen = true;
			callbacks.onError(errToString(err));
			this.finalize(callbacks);
			return;
		}

		const denyByDefault: RequestPermission = async () =>
			"deny" as PermissionDecision;

		const config: ChatSessionConfig = {
			vaultPath: options.vaultPath,
			settings: options.settings,
			extraSystemPrompt: options.extraSystemPrompt,
			disableSessionPersistence: true,
			requestPermission: options.requestPermission ?? denyByDefault,
			callbacks: {
				onSystemInit: (info) => callbacks.onSystemInit?.(info),
				onAssistantText: (text) => callbacks.onAssistantText(text),
				onToolUse: (tool) => callbacks.onToolUse(tool),
				onToolResult: (result) => callbacks.onToolResult(result),
				onResult: (result) => {
					this.lastResult = result;
					callbacks.onResult(result);
				},
				onError: (message) => {
					this.errorSeen = true;
					callbacks.onError(message);
				},
				// onTurnEnd is the single terminal hook: it fires after a result,
				// after a consume error, and on dispose/interrupt.
				onTurnEnd: () => this.finalize(callbacks),
			},
		};

		this.session = this.deps.createSession
			? this.deps.createSession(config)
			: new ChatSession(config);

		try {
			await this.session.start();
			this.session.send(promptText);
		} catch (err) {
			this.errorSeen = true;
			callbacks.onError(errToString(err));
			this.finalize(callbacks);
		}
	}

	/** Cancel the in-flight run. The resulting onTurnEnd settles as "stopped". */
	stop(): void {
		if (!this.running) return;
		this.stopped = true;
		void this.session?.dispose();
	}

	private finalize(callbacks: PromptRunCallbacks): void {
		if (this.finished) return;
		this.finished = true;
		this.running = false;

		const result = this.lastResult;
		const durationMs = result?.durationMs ?? Date.now() - this.startTime;

		let status: PromptRunStatus;
		let limit: PromptRunLimit | undefined;

		if (this.stopped) {
			status = "stopped";
		} else if (result?.subtype === "error_max_turns") {
			status = "limit";
			limit = "max_turns";
		} else if (result?.subtype === "error_max_budget_usd") {
			status = "limit";
			limit = "budget";
		} else if (
			this.errorSeen ||
			result?.isError ||
			(result != null && result.subtype !== "success")
		) {
			status = "error";
		} else {
			status = "success";
		}

		callbacks.onComplete({
			status,
			limit,
			costUsd: result?.costUsd,
			tokens: result?.tokens,
			durationMs,
		});

		// Release the SDK subprocess. Idempotent; a no-op if stop() already did.
		void this.session?.dispose();
	}
}
