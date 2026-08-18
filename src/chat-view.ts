import { ItemView, MarkdownRenderer, Notice, type WorkspaceLeaf } from "obsidian";
import {
	EFFORT_LABELS,
	PERMISSION_MODE_LABELS,
	isEffortSetting,
	isPermissionMode,
	type ChatPermissionMode,
	type EffortSetting,
	type PluginSettings,
} from "./settings";
import type { ActivityLock } from "./activity-lock";
import type { RunScope } from "./run-types";
import { type RunHistoryEntry, generateEntryId } from "./run-history";
import { VaultRefresher } from "./vault-refresher";
import { ChatSession, type ChatSessionConfig } from "./chat-session";
import type { PermissionDecision, PermissionRequest } from "./permission-types";
import {
	renderPermissionCard,
	type PermissionCardHandle,
} from "./permission-card";
import {
	type ToolCallEls,
	renderToolCall,
	renderToolResult,
} from "./tool-render";
import { formatResultMeta } from "./format";
import { labelCodeBlocks } from "./code-block";
import { WorkingIndicator } from "./working-indicator";
import {
	buildContextPreamble,
	composeMessage,
	pathToWikiLink,
} from "./chat-context";

export const VIEW_TYPE_CLAUDE_CHAT = "claude-vault-chat";

const APP_RESOURCE_PREFIX = "app://obsidian.md/";

/**
 * Resolve the in-vault link target for a clicked anchor, or null if it isn't a
 * vault link (e.g. an external http(s) URL). Handles both Obsidian-rendered wiki
 * links (which carry a `data-href`/`internal-link`) and plain Markdown links the
 * model may emit, which Obsidian's renderer rewrites to `app://obsidian.md/...`.
 */
export function vaultLinkFromAnchor(anchor: {
	internal: boolean;
	dataHref: string | null;
	href: string | null;
}): string | null {
	if (anchor.dataHref) return anchor.dataHref;

	const href = anchor.href ?? "";
	if (href.startsWith(APP_RESOURCE_PREFIX)) {
		let path = href.slice(APP_RESOURCE_PREFIX.length);
		try {
			path = decodeURIComponent(path);
		} catch {
			// keep the raw value if it isn't valid percent-encoding
		}
		path = (path.split(/[?#]/)[0] ?? "").trim();
		return path || null;
	}

	if (anchor.internal && href) return href;
	return null;
}

/** The note's file name without folders or the ".md" extension, for display. */
export function noteDisplayName(path: string): string {
	const base = path.split("/").pop() ?? path;
	return base.replace(/\.md$/i, "");
}

export interface ModelOption {
	value: string;
	label: string;
}

const BASE_MODEL_OPTIONS: ModelOption[] = [
	{ value: "", label: "Default (CLI)" },
	{ value: "opus", label: "Opus" },
	{ value: "sonnet", label: "Sonnet" },
	{ value: "haiku", label: "Haiku" },
];

/**
 * The model choices for the chat dropdown: the common aliases plus a "Default"
 * (let the CLI decide). If the configured Model override is a custom value not
 * in the base list, it is included and pre-selected so the dropdown reflects it.
 */
export function buildModelOptions(currentOverride: string): ModelOption[] {
	const options = [...BASE_MODEL_OPTIONS];
	const value = currentOverride.trim();
	if (value && !options.some((o) => o.value === value)) {
		options.push({ value, label: value });
	}
	return options;
}

/** Dependencies the view needs from the plugin to drive a chat session. */
export interface ChatViewDeps {
	getSettings: () => PluginSettings;
	getVaultPath: () => string | null;
	lock: ActivityLock;
	/** Injectable for tests; defaults to constructing a real ChatSession. */
	createSession?: (config: ChatSessionConfig) => ChatSession;
	/**
	 * Vault-relative path of the note currently open in Obsidian, or null.
	 * Optional: when absent, the context bar stays empty and no context is
	 * attached (keeps older callers and tests working).
	 */
	getActiveNotePath?: () => string | null;
	/**
	 * Subscribe to active-note changes; the callback fires whenever the user
	 * switches the focused note. Returns an unsubscribe function. Optional.
	 */
	onActiveNoteChange?: (cb: () => void) => () => void;
	/**
	 * Persist (insert or update) the history entry for the current chat
	 * session. Called after every completed turn. Optional.
	 */
	saveHistoryEntry?: (entry: RunHistoryEntry) => void;
	/**
	 * Notify the user that a prompt-launched run finished its first turn
	 * (Notice + system notification when unfocused). Optional.
	 */
	notifyRunComplete?: (
		promptName: string,
		status: string,
		durationSec: string
	) => void;
}

/** Everything the chat view needs to launch a PROMPT-file-driven session. */
export interface PromptChatLaunch {
	promptName: string;
	scope: RunScope;
	/** Full first message, including any note-scope restriction prefix. */
	message: string;
	/** Merged settings: prompt frontmatter overrides over plugin defaults. */
	settings: PluginSettings;
	notePath?: string;
	/** Extra system prompt text (e.g. vault CLAUDE.md). */
	extraSystemPrompt?: string;
}

const LOCK_LABEL = "Interactive chat turn";

export class ClaudeChatView extends ItemView {
	private deps: ChatViewDeps | null = null;
	private session: ChatSession | null = null;

	private transcriptEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private sendBtn: HTMLButtonElement | null = null;
	private stopBtn: HTMLButtonElement | null = null;
	private statusEl: HTMLElement | null = null;
	private modelSelect: HTMLSelectElement | null = null;
	private effortSelect: HTMLSelectElement | null = null;
	private permissionSelect: HTMLSelectElement | null = null;
	/** Model for this conversation; "" means let the CLI decide. */
	private selectedModel = "";
	/** Effort for this conversation; applied when the next session starts. */
	private selectedEffort: EffortSetting = "";
	/** Permission mode for this conversation; switchable live mid-session. */
	private selectedPermissionMode: ChatPermissionMode = "default";

	/** Per-launch settings from a PROMPT file; null for a plain chat. */
	private launchSettings: PluginSettings | null = null;
	private launchExtraSystemPrompt: string | undefined;
	/** CLI session to resume instead of starting fresh (from history). */
	private resumeSessionId: string | null = null;
	/** Live session id captured from the SDK init message. */
	private sessionId: string | null = null;

	/** Refreshes Obsidian's cache for files Claude modified during a turn. */
	private refresher = new VaultRefresher();

	// History bookkeeping: one entry per chat session, updated every turn.
	private historyId: string | null = null;
	private historyName: string | null = null;
	private historyScope: RunScope = "vault";
	private historyNotePath: string | undefined;
	private historyTimestamp = 0;
	private historyOutput = "";
	private historyDurationMs = 0;
	private historyCostUsd: number | undefined;
	private historyTokens: number | undefined;
	private historyStatus: RunHistoryEntry["status"] = "success";
	private completedTurns = 0;
	private turnStartedAt = 0;
	private lastTurnDurationMs: number | undefined;

	private currentAssistantEl: HTMLElement | null = null;
	private currentAssistantText = "";
	private toolCallEls: Map<string, ToolCallEls> = new Map();
	private pendingCards: Set<PermissionCardHandle> = new Set();
	private workingIndicator: WorkingIndicator | null = null;

	private contextBarEl: HTMLElement | null = null;
	/** Whether the active note is attached to the next turn as context. */
	private includeActiveNote = true;
	private unsubscribeActiveNote: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CLAUDE_CHAT;
	}

	getDisplayText(): string {
		return "Claude chat";
	}

	getIcon(): string {
		return "message-square";
	}

	setDeps(deps: ChatViewDeps): void {
		this.deps = deps;
	}

	onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("claude-chat-container");

		const header = container.createDiv({ cls: "claude-chat-header" });
		this.statusEl = header.createSpan({
			cls: "claude-chat-status-badge claude-status-idle",
			text: "Idle",
		});
		this.buildModelSelect(header);
		this.buildEffortSelect(header);
		this.buildPermissionSelect(header);
		const newBtn = header.createEl("button", {
			text: "New chat",
			cls: "claude-chat-new-btn",
		});
		newBtn.addEventListener("click", () => void this.handleNewChat());
		this.stopBtn = header.createEl("button", {
			text: "Stop",
			cls: "claude-chat-stop-btn",
		});
		this.stopBtn.addEventListener("click", () => void this.handleStop());
		this.stopBtn.hide();

		this.transcriptEl = container.createDiv({ cls: "claude-chat-transcript" });
		this.transcriptEl.addEventListener("click", (evt) =>
			this.handleLinkClick(evt)
		);

		this.contextBarEl = container.createDiv({ cls: "claude-chat-context-bar" });

		const inputRow = container.createDiv({ cls: "claude-chat-input-row" });
		this.inputEl = inputRow.createEl("textarea", {
			cls: "claude-chat-input",
			attr: { rows: "3", placeholder: "Message Claude..." },
		});
		this.inputEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" && !evt.shiftKey) {
				evt.preventDefault();
				void this.handleSend();
			}
		});
		this.sendBtn = inputRow.createEl("button", {
			text: "Send",
			cls: "claude-chat-send-btn",
		});
		this.sendBtn.addEventListener("click", () => void this.handleSend());

		this.unsubscribeActiveNote =
			this.deps?.onActiveNoteChange?.(() => this.refreshContextBar()) ?? null;
		this.refreshContextBar();

		return Promise.resolve();
	}

	/** Dispose the live session without tearing down the DOM (used on unload). */
	async shutdown(): Promise<void> {
		await this.teardownSession();
	}

	async onClose(): Promise<void> {
		await this.teardownSession();
		this.stopWorkingIndicator();
		this.unsubscribeActiveNote?.();
		this.unsubscribeActiveNote = null;
		this.transcriptEl = null;
		this.inputEl = null;
		this.sendBtn = null;
		this.stopBtn = null;
		this.statusEl = null;
		this.modelSelect = null;
		this.effortSelect = null;
		this.permissionSelect = null;
		this.contextBarEl = null;
		this.currentAssistantEl = null;
		this.currentAssistantText = "";
		this.toolCallEls.clear();
	}

	// --- session lifecycle -------------------------------------------------

	private ensureSession(): ChatSession | null {
		if (this.session) return this.session;
		if (!this.deps) return null;

		const vaultPath = this.deps.getVaultPath();
		if (!vaultPath) {
			new Notice("Could not resolve the vault path.");
			return null;
		}

		// A prompt launch pins its merged settings for the whole conversation;
		// the dropdown selections override model/effort/permission on top of
		// that (or of the global settings) without changing what's saved.
		const base = this.launchSettings ?? this.deps.getSettings();
		const config: ChatSessionConfig = {
			vaultPath,
			settings: {
				...base,
				modelOverride: this.selectedModel,
				effort: this.selectedEffort,
				permissionMode: this.selectedPermissionMode,
			},
			extraSystemPrompt: this.launchExtraSystemPrompt,
			resumeSessionId: this.resumeSessionId ?? undefined,
			requestPermission: this.requestPermission,
			callbacks: {
				onSystemInit: (info) => this.onSystemInit(info),
				onAssistantText: (text) => this.appendAssistantText(text),
				onToolUse: (tool) => this.addToolUse(tool),
				onToolResult: (result) => this.updateToolResult(result),
				onResult: (result) => this.addResultMeta(result),
				onError: (message) => this.addError(message),
				onTurnStart: () => this.onTurnStart(),
				onTurnEnd: () => this.onTurnEnd(),
				onUsage: (tokens) => this.workingIndicator?.setTokens(tokens),
			},
		};

		this.session = this.deps.createSession
			? this.deps.createSession(config)
			: new ChatSession(config);
		return this.session;
	}

	private async teardownSession(): Promise<void> {
		// Resolve any awaited permission prompt so dispose() can fully unwind.
		this.cancelPendingPermissions("deny");
		if (this.session) {
			await this.session.dispose();
			this.session = null;
		}
		if (this.deps && this.deps.lock.label === LOCK_LABEL) {
			this.deps.lock.release();
		}
	}

	// --- user actions ------------------------------------------------------

	private async handleSend(): Promise<void> {
		if (!this.inputEl || !this.deps) return;
		const text = this.inputEl.value.trim();
		if (!text) return;

		if (this.session?.isTurnActive) return;

		if (!this.deps.lock.tryAcquire(LOCK_LABEL)) {
			new Notice(`Claude is busy: ${this.deps.lock.label ?? "another run"}.`);
			return;
		}

		const session = this.ensureSession();
		if (!session) {
			this.deps.lock.release();
			return;
		}

		this.inputEl.value = "";

		this.beginHistory(text.length > 40 ? text.slice(0, 40) + "…" : text);

		const contextPaths = this.currentContextPaths();
		const message = composeMessage(buildContextPreamble(contextPaths), text);
		this.addUserMessage(text, contextPaths);

		try {
			await session.start();
			session.send(message);
		} catch (err) {
			this.deps.lock.release();
			this.addError(err instanceof Error ? err.message : String(err));
			this.setStatus("error", "Error");
		}
	}

	/**
	 * Start a fresh conversation from a PROMPT-*.md file: the merged
	 * frontmatter-over-defaults settings become the session settings (synced
	 * into the header dropdowns) and the prompt body is auto-submitted as the
	 * first message. The conversation then continues interactively.
	 */
	async startPromptChat(launch: PromptChatLaunch): Promise<void> {
		if (!this.deps) return;

		await this.handleNewChat();

		this.launchSettings = launch.settings;
		this.launchExtraSystemPrompt = launch.extraSystemPrompt;
		this.selectedModel = launch.settings.modelOverride;
		this.selectedEffort = launch.settings.effort;
		this.selectedPermissionMode = launch.settings.permissionMode;
		this.syncSelectors();

		this.historyScope = launch.scope;
		this.historyNotePath = launch.notePath;
		this.beginHistory(launch.promptName);

		if (!this.deps.lock.tryAcquire(LOCK_LABEL)) {
			new Notice(`Claude is busy: ${this.deps.lock.label ?? "another run"}.`);
			return;
		}

		const session = this.ensureSession();
		if (!session) {
			this.deps.lock.release();
			return;
		}

		this.addUserMessage(launch.message);

		try {
			await session.start();
			session.send(launch.message);
		} catch (err) {
			this.deps.lock.release();
			this.addError(err instanceof Error ? err.message : String(err));
			this.setStatus("error", "Error");
		}
	}

	/**
	 * Prepare the view to continue a past conversation from history. The prior
	 * output is shown as context and the SDK session is resumed (options.resume)
	 * when the user sends their next message. Further turns keep updating the
	 * same history entry.
	 */
	async resumeFromHistory(entry: RunHistoryEntry): Promise<void> {
		if (!entry.sessionId) {
			new Notice("This history entry has no resumable session.");
			return;
		}

		await this.handleNewChat();

		this.resumeSessionId = entry.sessionId;
		this.sessionId = entry.sessionId;
		this.historyId = entry.id;
		this.historyName = entry.promptName;
		this.historyScope = entry.scope;
		this.historyNotePath = entry.notePath;
		this.historyTimestamp = entry.timestamp;
		this.historyOutput = entry.output;
		this.historyDurationMs = entry.durationMs;
		this.historyCostUsd = entry.costUsd;
		this.historyTokens = entry.tokens;

		if (this.transcriptEl) {
			this.transcriptEl.createDiv({
				cls: "claude-chat-resume-marker",
				text: `Resumed "${entry.promptName}" — the model retains the full conversation.`,
			});
			if (entry.output) {
				const el = this.transcriptEl.createDiv({
					cls: "claude-chat-msg claude-chat-msg-assistant",
				});
				void MarkdownRenderer.render(this.app, entry.output, el, "/", this).then(
					() => {
						labelCodeBlocks(el);
						this.scrollToBottom();
					}
				);
			}
		}
		this.scrollToBottom();
		this.inputEl?.focus();
	}

	/** Initialize this session's history identity on its first user message. */
	private beginHistory(name: string): void {
		if (this.historyId) return;
		this.historyId = generateEntryId();
		this.historyName = name;
		this.historyTimestamp = Date.now();
	}

	private buildModelSelect(header: HTMLElement): void {
		this.selectedModel = this.deps?.getSettings().modelOverride ?? "";

		const wrap = header.createDiv({ cls: "claude-chat-model" });
		wrap.createSpan({ cls: "claude-chat-model-label", text: "Model" });
		// `dropdown` is Obsidian's built-in select style; it provides the caret
		// icon and themed background so it reads as a dropdown.
		const select = wrap.createEl("select", {
			cls: "dropdown claude-chat-model-select",
		});
		select.setAttr("aria-label", "Model for this conversation");
		for (const opt of buildModelOptions(this.selectedModel)) {
			const optionEl = select.createEl("option", { text: opt.label });
			optionEl.value = opt.value;
			if (opt.value === this.selectedModel) optionEl.selected = true;
		}
		select.addEventListener("change", () => this.handleModelChange());
		this.modelSelect = select;
	}

	private buildEffortSelect(header: HTMLElement): void {
		this.selectedEffort = this.deps?.getSettings().effort ?? "";

		const wrap = header.createDiv({ cls: "claude-chat-model" });
		wrap.createSpan({ cls: "claude-chat-model-label", text: "Effort" });
		const select = wrap.createEl("select", {
			cls: "dropdown claude-chat-model-select",
		});
		select.setAttr("aria-label", "Reasoning effort for this conversation");
		for (const [value, label] of Object.entries(EFFORT_LABELS)) {
			const optionEl = select.createEl("option", { text: label });
			optionEl.value = value;
			if (value === this.selectedEffort) optionEl.selected = true;
		}
		select.addEventListener("change", () => this.handleEffortChange());
		this.effortSelect = select;
	}

	private buildPermissionSelect(header: HTMLElement): void {
		this.selectedPermissionMode =
			this.deps?.getSettings().permissionMode ?? "default";

		const wrap = header.createDiv({ cls: "claude-chat-model" });
		wrap.createSpan({ cls: "claude-chat-model-label", text: "Permissions" });
		const select = wrap.createEl("select", {
			cls: "dropdown claude-chat-model-select",
		});
		select.setAttr("aria-label", "Permission mode for this conversation");
		for (const [value, label] of Object.entries(PERMISSION_MODE_LABELS)) {
			const optionEl = select.createEl("option", { text: label });
			optionEl.value = value;
			if (value === this.selectedPermissionMode) optionEl.selected = true;
		}
		select.addEventListener("change", () => this.handlePermissionChange());
		this.permissionSelect = select;
	}

	private handleModelChange(): void {
		if (!this.modelSelect) return;
		this.selectedModel = this.modelSelect.value;
		// Apply live if a conversation is already running; otherwise it is used
		// when the next session starts.
		if (this.session) {
			void this.session.setModel(this.selectedModel || undefined);
		}
	}

	private handleEffortChange(): void {
		if (!this.effortSelect) return;
		const value = this.effortSelect.value;
		if (!isEffortSetting(value)) return;
		this.selectedEffort = value;
		// The SDK has no live effort switch; the subprocess is started with a
		// fixed effort, so a mid-conversation change only affects the next chat.
		if (this.session) {
			new Notice("Effort applies when the next chat session starts.");
		}
	}

	private handlePermissionChange(): void {
		if (!this.permissionSelect) return;
		const value = this.permissionSelect.value;
		if (!isPermissionMode(value)) return;
		this.selectedPermissionMode = value;
		// Apply live if a conversation is already running; otherwise it is used
		// when the next session starts.
		if (this.session) {
			void this.session.setPermissionMode(value);
		}
	}

	/** Push the selected model/effort/permission values into the dropdowns. */
	private syncSelectors(): void {
		if (this.modelSelect) {
			this.modelSelect.empty();
			for (const opt of buildModelOptions(this.selectedModel)) {
				const optionEl = this.modelSelect.createEl("option", {
					text: opt.label,
				});
				optionEl.value = opt.value;
				if (opt.value === this.selectedModel) optionEl.selected = true;
			}
		}
		if (this.effortSelect) this.effortSelect.value = this.selectedEffort;
		if (this.permissionSelect) {
			this.permissionSelect.value = this.selectedPermissionMode;
		}
	}

	private async handleStop(): Promise<void> {
		// Deny any pending permission prompt first so the awaited canUseTool
		// resolves and the interrupt can unwind the in-flight turn.
		this.cancelPendingPermissions("deny");
		if (this.session) {
			await this.session.interrupt();
		}
	}

	private async handleNewChat(): Promise<void> {
		await this.teardownSession();
		this.stopWorkingIndicator();
		this.transcriptEl?.empty();
		this.currentAssistantEl = null;
		this.currentAssistantText = "";
		this.toolCallEls.clear();
		this.setStatus("idle", "Idle");

		// Drop per-conversation state: prompt-launch settings, resume target,
		// and the history identity so the next conversation gets its own entry.
		this.launchSettings = null;
		this.launchExtraSystemPrompt = undefined;
		this.resumeSessionId = null;
		this.sessionId = null;
		this.refresher.clear();
		this.historyId = null;
		this.historyName = null;
		this.historyScope = "vault";
		this.historyNotePath = undefined;
		this.historyTimestamp = 0;
		this.historyOutput = "";
		this.historyDurationMs = 0;
		this.historyCostUsd = undefined;
		this.historyTokens = undefined;
		this.historyStatus = "success";
		this.completedTurns = 0;
	}

	// --- context bar -------------------------------------------------------

	/** The note paths attached to the next turn (empty when unchecked or none). */
	private currentContextPaths(): string[] {
		if (!this.includeActiveNote) return [];
		const path = this.deps?.getActiveNotePath?.() ?? null;
		return path ? [path] : [];
	}

	/**
	 * Redraw the context bar from the current active note: a checkbox whose
	 * checked state tracks includeActiveNote, or a muted placeholder when no note
	 * is open. Called on open and on every active-note change.
	 */
	private refreshContextBar(): void {
		const bar = this.contextBarEl;
		if (!bar) return;
		bar.empty();
		bar.createSpan({
			cls: "claude-chat-context-bar-label",
			text: "Context",
		});

		const path = this.deps?.getActiveNotePath?.() ?? null;
		if (!path) {
			bar.createSpan({
				cls: "claude-chat-context-empty",
				text: "No note open",
			});
			return;
		}

		const item = bar.createEl("label", { cls: "claude-chat-context-item" });
		const checkbox = item.createEl("input", {
			cls: "claude-chat-context-checkbox",
			attr: { type: "checkbox" },
		});
		checkbox.checked = this.includeActiveNote;
		checkbox.addEventListener("change", () => {
			this.includeActiveNote = checkbox.checked;
		});
		item.createSpan({
			cls: "claude-chat-context-name",
			text: noteDisplayName(path),
			attr: { title: path },
		});
	}

	// --- session callbacks -------------------------------------------------

	private onSystemInit(info: {
		model?: string;
		tools?: string[];
		sessionId?: string;
	}): void {
		if (info.sessionId) {
			this.sessionId = info.sessionId;
		}
		if (info.model) {
			this.setStatus("running", `Running - ${info.model}`);
		}
	}

	private onTurnStart(): void {
		this.turnStartedAt = Date.now();
		this.lastTurnDurationMs = undefined;
		this.setStatus("running", "Running");
		this.stopBtn?.show();
		this.setInputEnabled(false);
		this.startWorkingIndicator();
	}

	private onTurnEnd(): void {
		this.stopWorkingIndicator();
		this.finalizeAssistant();
		this.setStatus("idle", "Idle");
		this.stopBtn?.hide();
		this.setInputEnabled(true);
		if (this.deps && this.deps.lock.label === LOCK_LABEL) {
			this.deps.lock.release();
		}

		this.completedTurns += 1;
		this.historyDurationMs +=
			this.lastTurnDurationMs ?? Date.now() - this.turnStartedAt;
		this.recordHistory();

		// A prompt-launched run notifies once, when its auto-submitted first
		// turn settles (mirrors the old one-off runner's completion Notice).
		if (this.launchSettings && this.completedTurns === 1) {
			const durationSec = (this.historyDurationMs / 1000).toFixed(1);
			const label =
				this.historyStatus === "success"
					? "complete"
					: this.historyStatus === "limit"
						? "limit reached"
						: this.historyStatus;
			this.deps?.notifyRunComplete?.(
				this.historyName ?? "Prompt",
				label,
				durationSec
			);
		}

		// Let Obsidian pick up any files Claude modified during the turn.
		if (this.refresher.getModifiedPaths().size > 0) {
			this.refresher.refreshModifiedFiles(this.app).catch((err) => {
				console.error("Failed to refresh vault files:", err);
			});
			this.refresher.clear();
		}

		this.inputEl?.focus();
	}

	/** Upsert this conversation's history entry via the plugin. */
	private recordHistory(): void {
		if (!this.historyId || !this.deps?.saveHistoryEntry) return;
		const entry: RunHistoryEntry = {
			id: this.historyId,
			promptName: this.historyName ?? "Chat",
			scope: this.historyScope,
			timestamp: this.historyTimestamp,
			durationMs: this.historyDurationMs,
			status: this.historyStatus,
			output: this.historyOutput,
		};
		if (this.historyCostUsd !== undefined) entry.costUsd = this.historyCostUsd;
		if (this.historyTokens !== undefined) entry.tokens = this.historyTokens;
		if (this.historyNotePath) entry.notePath = this.historyNotePath;
		const sessionId = this.sessionId ?? this.resumeSessionId;
		if (sessionId) entry.sessionId = sessionId;
		this.deps.saveHistoryEntry(entry);
	}

	/** Show the inline "Claude is working" indicator at the transcript bottom. */
	private startWorkingIndicator(): void {
		this.stopWorkingIndicator();
		if (!this.transcriptEl) return;
		this.workingIndicator = new WorkingIndicator(this.transcriptEl);
		this.scrollToBottom();
	}

	private stopWorkingIndicator(): void {
		this.workingIndicator?.stop();
		this.workingIndicator = null;
	}

	// --- transcript rendering ---------------------------------------------

	private addUserMessage(text: string, contextPaths: string[] = []): void {
		if (!this.transcriptEl) return;
		this.finalizeAssistant();
		const msg = this.transcriptEl.createDiv({
			cls: "claude-chat-msg claude-chat-msg-user",
		});
		msg.createEl("pre", { text, cls: "claude-chat-user-text" });
		if (contextPaths.length > 0) {
			const links = contextPaths
				.map((p) => `[[${pathToWikiLink(p)}]]`)
				.join(", ");
			const caption = this.transcriptEl.createDiv({
				cls: "claude-chat-context-caption",
			});
			// Render through Markdown so the wiki links become clickable
			// internal-link anchors, resolved by the transcript's click handler.
			void MarkdownRenderer.render(
				this.app,
				`Context: ${links}`,
				caption,
				"/",
				this
			).then(() => this.scrollToBottom());
		}
		this.scrollToBottom();
	}

	private appendAssistantText(text: string): void {
		if (!this.transcriptEl) return;
		if (!this.currentAssistantEl) {
			this.currentAssistantEl = this.transcriptEl.createDiv({
				cls: "claude-chat-msg claude-chat-msg-assistant",
			});
			this.currentAssistantText = "";
		}
		this.currentAssistantText += text;
		this.historyOutput += text.endsWith("\n") ? text : `${text}\n\n`;
		this.renderAssistantMarkdown();
		this.scrollToBottom();
	}

	private renderAssistantMarkdown(): void {
		if (!this.currentAssistantEl) return;
		const el = this.currentAssistantEl;
		el.empty();
		void MarkdownRenderer.render(
			this.app,
			this.currentAssistantText,
			el,
			"/",
			this
		).then(() => {
			labelCodeBlocks(el);
			this.scrollToBottom();
		});
	}

	private finalizeAssistant(): void {
		this.currentAssistantEl = null;
		this.currentAssistantText = "";
	}

	private addToolUse(tool: {
		id?: string;
		name: string;
		filePath?: string;
		input?: Record<string, unknown>;
	}): void {
		if (!this.transcriptEl) return;
		this.refresher.trackToolUse(tool.name, tool.filePath);
		this.finalizeAssistant();
		const els = renderToolCall(this.transcriptEl, {
			toolName: tool.name,
			filePath: tool.filePath,
			input: tool.input,
		});
		if (tool.id) this.toolCallEls.set(tool.id, els);
		this.scrollToBottom();
	}

	private updateToolResult(result: {
		toolUseId: string;
		isError: boolean;
		content: string;
	}): void {
		const els = this.toolCallEls.get(result.toolUseId);
		if (!els) return;
		renderToolResult(els, result.isError, result.content);
		this.toolCallEls.delete(result.toolUseId);
		this.scrollToBottom();
	}

	private addResultMeta(result: {
		costUsd?: number;
		durationMs?: number;
		tokens?: number;
		isError: boolean;
		subtype?: string;
	}): void {
		// Accumulate per-turn cost/tokens into the session's history entry.
		if (result.costUsd !== undefined) {
			this.historyCostUsd = (this.historyCostUsd ?? 0) + result.costUsd;
		}
		if (result.tokens !== undefined) {
			this.historyTokens = (this.historyTokens ?? 0) + result.tokens;
		}
		this.lastTurnDurationMs = result.durationMs;
		if (result.subtype === "success") {
			this.historyStatus = "success";
		} else if (
			result.subtype === "error_max_turns" ||
			result.subtype === "error_max_budget_usd"
		) {
			this.historyStatus = "limit";
		} else {
			this.historyStatus = "error";
		}

		if (!this.transcriptEl) return;
		const text = formatResultMeta(result);
		if (text) {
			this.transcriptEl.createDiv({
				cls: "claude-chat-result-meta",
				text,
			});
		}
		this.scrollToBottom();
	}

	private addError(message: string): void {
		if (!this.transcriptEl) return;
		this.transcriptEl.createDiv({
			cls: "claude-chat-error",
			text: message,
		});
		this.scrollToBottom();
	}

	// --- permission prompt -------------------------------------------------

	private requestPermission = (
		req: PermissionRequest
	): Promise<PermissionDecision> => {
		return new Promise((resolve) => {
			if (!this.transcriptEl) {
				resolve("deny");
				return;
			}
			this.finalizeAssistant();
			const handle = renderPermissionCard(this.transcriptEl, req, (decision) => {
				this.pendingCards.delete(handle);
				resolve(decision);
			});
			this.pendingCards.add(handle);
			this.scrollToBottom();
		});
	};

	private cancelPendingPermissions(decision: PermissionDecision = "deny"): void {
		for (const handle of [...this.pendingCards]) handle.cancel(decision);
		this.pendingCards.clear();
	}

	private handleLinkClick(evt: MouseEvent): void {
		const target = evt.target as HTMLElement;
		const anchor = target.closest("a");
		if (!anchor) return;

		const linktext = vaultLinkFromAnchor({
			internal: anchor.classList.contains("internal-link"),
			dataHref: anchor.getAttribute("data-href"),
			href: anchor.getAttribute("href"),
		});
		if (!linktext) return;

		// Open in a separate leaf so the click never replaces the chat pane.
		evt.preventDefault();
		void this.app.workspace.openLinkText(linktext, "/", true);
	}

	// --- helpers -----------------------------------------------------------

	private setStatus(state: string, label: string): void {
		if (!this.statusEl) return;
		this.statusEl.className = `claude-chat-status-badge claude-status-${state}`;
		this.statusEl.setText(label);
	}

	private setInputEnabled(enabled: boolean): void {
		if (this.inputEl) this.inputEl.disabled = !enabled;
		if (this.sendBtn) this.sendBtn.disabled = !enabled;
		// Lock the model and effort pickers mid-turn so they can't change under
		// an in-flight request. The permission mode stays enabled: it switches
		// live via setPermissionMode, which is most useful mid-turn.
		if (this.modelSelect) this.modelSelect.disabled = !enabled;
		if (this.effortSelect) this.effortSelect.disabled = !enabled;
	}

	private scrollToBottom(): void {
		// Keep the working indicator the last child so freshly appended content
		// renders above it, then pin the scroll to the bottom.
		this.workingIndicator?.bump();
		if (this.transcriptEl) {
			this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
		}
	}
}
