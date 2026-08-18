import type {
	Options,
	CanUseTool,
	PermissionMode,
	PermissionResult,
	Query,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PluginSettings } from "./settings";
import { PLUGIN_SYSTEM_PROMPT } from "./system-prompt";
import type {
	PermissionDecision,
	PermissionRequest,
	RequestPermission,
} from "./permission-types";
import { resolveSpawnEnv } from "./env-resolver";
import { patchElectronEventTarget } from "./electron-compat";
import { sumUsageTokens, outputTokensFromUsage } from "./format";

// Re-export the permission contract so existing importers of these types from
// "./chat-session" keep working; the canonical home is "./permission-types".
export type { PermissionDecision, PermissionRequest, RequestPermission };

/** A tool call surfaced to the chat transcript. */
export interface ChatToolUse {
	id?: string;
	name: string;
	filePath?: string;
	input?: Record<string, unknown>;
}

export interface ChatToolResult {
	toolUseId: string;
	isError: boolean;
	content: string;
}

export interface ChatResult {
	text?: string;
	costUsd?: number;
	durationMs?: number;
	tokens?: number;
	isError: boolean;
	/** Raw SDK result subtype, e.g. "success", "error_max_turns", "error_max_budget_usd". */
	subtype?: string;
}

export interface ChatCallbacks {
	onSystemInit?: (info: {
		model?: string;
		tools?: string[];
		sessionId?: string;
	}) => void;
	onAssistantText: (text: string) => void;
	onToolUse: (tool: ChatToolUse) => void;
	onToolResult: (result: ChatToolResult) => void;
	onResult: (result: ChatResult) => void;
	onError: (message: string) => void;
	onTurnStart?: () => void;
	onTurnEnd?: () => void;
	/**
	 * Running count of output tokens generated so far this turn, emitted each
	 * time an assistant message arrives. Drives the live working indicator.
	 */
	onUsage?: (tokens: number) => void;
}

export type QueryFn = (params: {
	prompt: AsyncIterable<SDKUserMessage>;
	options?: Options;
}) => Query | Promise<Query>;

export interface ChatSessionConfig {
	vaultPath: string;
	settings: PluginSettings;
	callbacks: ChatCallbacks;
	requestPermission: RequestPermission;
	/** Injectable for tests; defaults to the real Agent SDK query(). */
	queryFn?: QueryFn;
	/** Injectable for tests; defaults to the login-shell env resolver. */
	resolveEnv?: () => Record<string, string>;
	/** Extra text appended after PLUGIN_SYSTEM_PROMPT (e.g. vault CLAUDE.md). */
	extraSystemPrompt?: string;
	/** Pass --no-session-persistence so the run leaves no stored session. */
	disableSessionPersistence?: boolean;
	/** Resume a persisted CLI session instead of starting fresh. */
	resumeSessionId?: string;
}

/**
 * Build the Agent SDK options for an interactive chat: the allowedTools
 * whitelist auto-approves, the configured permissionMode governs everything
 * else (in "default" mode anything not whitelisted prompts via canUseTool),
 * and the Obsidian wiki-link instructions are appended to the default system
 * prompt.
 */
export function buildChatOptions(params: {
	vaultPath: string;
	settings: PluginSettings;
	env: Record<string, string>;
	canUseTool: CanUseTool;
	/** Extra text appended after PLUGIN_SYSTEM_PROMPT (e.g. vault CLAUDE.md). */
	extraSystemPrompt?: string;
	/** Pass --no-session-persistence so the run leaves no stored session. */
	disableSessionPersistence?: boolean;
	/** Resume a persisted CLI session instead of starting fresh. */
	resumeSessionId?: string;
}): Options {
	const {
		vaultPath,
		settings,
		env,
		canUseTool,
		extraSystemPrompt,
		disableSessionPersistence,
		resumeSessionId,
	} = params;

	const append = extraSystemPrompt
		? `${PLUGIN_SYSTEM_PROMPT}\n\n${extraSystemPrompt}`
		: PLUGIN_SYSTEM_PROMPT;

	const options: Options = {
		cwd: vaultPath,
		pathToClaudeCodeExecutable: settings.cliPath,
		permissionMode: settings.permissionMode,
		allowedTools: settings.allowedTools,
		systemPrompt: {
			type: "preset",
			preset: "claude_code",
			append,
		},
		canUseTool,
		env,
		includePartialMessages: false,
	};

	if (settings.maxTurns > 0) {
		options.maxTurns = settings.maxTurns;
	}
	if (settings.modelOverride) {
		options.model = settings.modelOverride;
	}
	if (settings.effort) {
		options.effort = settings.effort;
	}
	if (resumeSessionId) {
		options.resume = resumeSessionId;
	}

	const extraArgs: Record<string, string | null> = {};
	if (settings.maxBudget !== null && settings.maxBudget > 0) {
		// No native budget option; pass the CLI flag through.
		extraArgs["max-budget-usd"] = String(settings.maxBudget);
	}
	if (disableSessionPersistence) {
		// Valueless CLI flag (null => no value emitted).
		extraArgs["no-session-persistence"] = null;
	}
	if (Object.keys(extraArgs).length > 0) {
		options.extraArgs = extraArgs;
	}

	return options;
}

const defaultQueryFn: QueryFn = async (params) => {
	patchElectronEventTarget();
	const mod = await import("@anthropic-ai/claude-agent-sdk");
	return mod.query(params);
};

/**
 * An async queue that exposes pushed messages as an AsyncIterable. The SDK
 * consumes this as streaming input; the iterable stays open until close(), so
 * the underlying process lives across turns.
 */
class MessageQueue implements AsyncIterable<SDKUserMessage> {
	private pending: SDKUserMessage[] = [];
	private waiting: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
	private closed = false;

	push(msg: SDKUserMessage): void {
		if (this.closed) return;
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: msg, done: false });
		} else {
			this.pending.push(msg);
		}
	}

	close(): void {
		this.closed = true;
		let waiter = this.waiting.shift();
		while (waiter) {
			waiter({ value: undefined as never, done: true });
			waiter = this.waiting.shift();
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
		return {
			next: (): Promise<IteratorResult<SDKUserMessage>> => {
				const next = this.pending.shift();
				if (next) return Promise.resolve({ value: next, done: false });
				if (this.closed) {
					return Promise.resolve({ value: undefined as never, done: true });
				}
				return new Promise((resolve) => this.waiting.push(resolve));
			},
		};
	}
}

function errToString(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

/**
 * Drives a single multi-turn interactive conversation backed by the Agent SDK.
 * One ChatSession owns one CLI subprocess for its whole lifetime.
 */
export class ChatSession {
	private readonly config: ChatSessionConfig;
	private readonly queryFn: QueryFn;
	private readonly resolveEnv: () => Record<string, string>;
	private readonly inputQueue = new MessageQueue();
	private readonly sessionAllowed = new Set<string>();

	private query: Query | null = null;
	private started = false;
	private disposed = false;
	private turnActive = false;
	/** Cumulative output tokens for the in-flight turn; reset on startTurn. */
	private turnOutputTokens = 0;

	constructor(config: ChatSessionConfig) {
		this.config = config;
		this.queryFn = config.queryFn ?? defaultQueryFn;
		this.resolveEnv = config.resolveEnv ?? (() => resolveSpawnEnv());
	}

	get isTurnActive(): boolean {
		return this.turnActive;
	}

	/** Tool names the user approved for the rest of this conversation. */
	get sessionAllowedTools(): string[] {
		return [...this.sessionAllowed];
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;

		const env = this.resolveEnv();
		const options = buildChatOptions({
			vaultPath: this.config.vaultPath,
			settings: this.config.settings,
			env,
			canUseTool: this.canUseTool,
			extraSystemPrompt: this.config.extraSystemPrompt,
			disableSessionPersistence: this.config.disableSessionPersistence,
			resumeSessionId: this.config.resumeSessionId,
		});

		this.query = await this.queryFn({ prompt: this.inputQueue, options });
		void this.consume();
	}

	/** Send a user turn. Marks the turn active until a result arrives. */
	send(text: string): void {
		if (!this.started || this.disposed) return;
		this.startTurn();
		this.inputQueue.push({
			type: "user",
			parent_tool_use_id: null,
			message: { role: "user", content: text },
		});
	}

	/**
	 * Switch the model for the live conversation. No-op if the session hasn't
	 * started yet (the chosen model is applied via options when it does).
	 */
	async setModel(model: string | undefined): Promise<void> {
		if (!this.query) return;
		try {
			await this.query.setModel(model);
		} catch (err) {
			this.config.callbacks.onError(errToString(err));
		}
	}

	/**
	 * Switch the permission mode for the live conversation. No-op if the session
	 * hasn't started yet (the chosen mode is applied via options when it does).
	 */
	async setPermissionMode(mode: PermissionMode): Promise<void> {
		if (!this.query) return;
		try {
			await this.query.setPermissionMode(mode);
		} catch (err) {
			this.config.callbacks.onError(errToString(err));
		}
	}

	/** Interrupt the in-flight turn without ending the conversation. */
	async interrupt(): Promise<void> {
		if (this.query && this.turnActive) {
			try {
				await this.query.interrupt();
			} catch (err) {
				this.config.callbacks.onError(errToString(err));
			}
			this.endTurn();
		}
	}

	/** End the conversation and release the subprocess. */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		if (this.query && this.turnActive) {
			try {
				await this.query.interrupt();
			} catch {
				// best effort
			}
		}
		this.endTurn();
		this.inputQueue.close();
	}

	private canUseTool: CanUseTool = async (
		toolName,
		input,
		options
	): Promise<PermissionResult> => {
		if (this.sessionAllowed.has(toolName)) {
			return { behavior: "allow", updatedInput: input };
		}

		let decision: PermissionDecision;
		try {
			decision = await this.config.requestPermission({
				toolName,
				input,
				toolUseId: options.toolUseID,
				title: options.title,
				description: options.description,
			});
		} catch {
			decision = "deny";
		}

		if (decision === "deny") {
			return { behavior: "deny", message: "Denied by user." };
		}
		if (decision === "session") {
			this.sessionAllowed.add(toolName);
		}
		return { behavior: "allow", updatedInput: input };
	};

	private async consume(): Promise<void> {
		if (!this.query) return;
		try {
			for await (const msg of this.query) {
				this.handleMessage(msg);
			}
		} catch (err) {
			if (!this.disposed) {
				this.config.callbacks.onError(errToString(err));
			}
			this.endTurn();
		}
	}

	private handleMessage(msg: SDKMessage): void {
		const data = msg as unknown as Record<string, unknown>;
		switch (msg.type) {
			case "system":
				if (data["subtype"] === "init") {
					this.config.callbacks.onSystemInit?.({
						model: asString(data["model"]),
						tools: asStringArray(data["tools"]),
						sessionId: asString(data["session_id"]),
					});
				}
				break;
			case "assistant":
				this.handleAssistant(data);
				break;
			case "user":
				this.handleUser(data);
				break;
			case "result":
				this.handleResult(data);
				break;
			default:
				break;
		}
	}

	private handleAssistant(data: Record<string, unknown>): void {
		const message = data["message"] as Record<string, unknown> | undefined;

		// Accumulate output tokens for the live working indicator. Each assistant
		// message reports the tokens produced by that step; summing them gives a
		// monotonically growing "generated so far" count.
		const stepTokens = outputTokensFromUsage(message?.["usage"]);
		if (stepTokens > 0) {
			this.turnOutputTokens += stepTokens;
			this.config.callbacks.onUsage?.(this.turnOutputTokens);
		}

		const content = message?.["content"];
		if (!Array.isArray(content)) return;

		for (const raw of content) {
			const block = raw as Record<string, unknown>;
			if (block["type"] === "text") {
				const text = block["text"];
				if (typeof text === "string" && text.length > 0) {
					this.config.callbacks.onAssistantText(text);
				}
			} else if (block["type"] === "tool_use") {
				const name = block["name"];
				if (typeof name !== "string") continue;
				const input = block["input"] as Record<string, unknown> | undefined;
				const filePath =
					input && typeof input["file_path"] === "string"
						? input["file_path"]
						: undefined;
				this.config.callbacks.onToolUse({
					id: asString(block["id"]),
					name,
					filePath,
					input,
				});
			}
		}
	}

	private handleUser(data: Record<string, unknown>): void {
		const message = data["message"] as Record<string, unknown> | undefined;
		const content = message?.["content"];
		if (!Array.isArray(content)) return;

		for (const raw of content) {
			const block = raw as Record<string, unknown>;
			if (block["type"] !== "tool_result") continue;
			const toolUseId = block["tool_use_id"];
			if (typeof toolUseId !== "string") continue;
			this.config.callbacks.onToolResult({
				toolUseId,
				isError: block["is_error"] === true,
				content: stringifyContent(block["content"]),
			});
		}
	}

	private handleResult(data: Record<string, unknown>): void {
		const costUsd =
			asNumber(data["total_cost_usd"]) ?? asNumber(data["cost_usd"]);
		this.config.callbacks.onResult({
			text: asString(data["result"]),
			costUsd,
			durationMs: asNumber(data["duration_ms"]),
			tokens: sumUsageTokens(data["usage"]),
			isError: data["is_error"] === true || data["subtype"] !== "success",
			subtype: asString(data["subtype"]),
		});
		this.endTurn();
	}

	private startTurn(): void {
		if (this.turnActive) return;
		this.turnActive = true;
		this.turnOutputTokens = 0;
		this.config.callbacks.onTurnStart?.();
	}

	private endTurn(): void {
		if (!this.turnActive) return;
		this.turnActive = false;
		this.config.callbacks.onTurnEnd?.();
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((v): v is string => typeof v === "string");
}

function stringifyContent(raw: unknown): string {
	if (typeof raw === "string") return raw;
	if (Array.isArray(raw)) {
		const parts: string[] = [];
		for (const item of raw) {
			const block = item as Record<string, unknown>;
			if (block && block["type"] === "text" && typeof block["text"] === "string") {
				parts.push(block["text"]);
			}
		}
		return parts.join("\n");
	}
	return "";
}
