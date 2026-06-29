import { ItemView, MarkdownRenderer, Notice, type WorkspaceLeaf } from "obsidian";
import type { PluginSettings } from "./settings";
import type { ActivityLock } from "./activity-lock";
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
	/** Model for this conversation; "" means let the CLI decide. */
	private selectedModel = "";

	private currentAssistantEl: HTMLElement | null = null;
	private currentAssistantText = "";
	private toolCallEls: Map<string, ToolCallEls> = new Map();
	private pendingCards: Set<PermissionCardHandle> = new Set();
	private workingIndicator: WorkingIndicator | null = null;

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

		return Promise.resolve();
	}

	/** Dispose the live session without tearing down the DOM (used on unload). */
	async shutdown(): Promise<void> {
		await this.teardownSession();
	}

	async onClose(): Promise<void> {
		await this.teardownSession();
		this.stopWorkingIndicator();
		this.transcriptEl = null;
		this.inputEl = null;
		this.sendBtn = null;
		this.stopBtn = null;
		this.statusEl = null;
		this.modelSelect = null;
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

		const config: ChatSessionConfig = {
			vaultPath,
			// The dropdown selection overrides the global Model override for this
			// conversation only; it never changes the saved settings.
			settings: { ...this.deps.getSettings(), modelOverride: this.selectedModel },
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
		this.addUserMessage(text);

		try {
			await session.start();
			session.send(text);
		} catch (err) {
			this.deps.lock.release();
			this.addError(err instanceof Error ? err.message : String(err));
			this.setStatus("error", "Error");
		}
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

	private handleModelChange(): void {
		if (!this.modelSelect) return;
		this.selectedModel = this.modelSelect.value;
		// Apply live if a conversation is already running; otherwise it is used
		// when the next session starts.
		if (this.session) {
			void this.session.setModel(this.selectedModel || undefined);
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
	}

	// --- session callbacks -------------------------------------------------

	private onSystemInit(info: { model?: string; tools?: string[] }): void {
		if (info.model) {
			this.setStatus("running", `Running - ${info.model}`);
		}
	}

	private onTurnStart(): void {
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
		this.inputEl?.focus();
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

	private addUserMessage(text: string): void {
		if (!this.transcriptEl) return;
		this.finalizeAssistant();
		const msg = this.transcriptEl.createDiv({
			cls: "claude-chat-msg claude-chat-msg-user",
		});
		msg.createEl("pre", { text, cls: "claude-chat-user-text" });
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
	}): void {
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
		// Lock the model picker mid-turn so the model can't change under an
		// in-flight request.
		if (this.modelSelect) this.modelSelect.disabled = !enabled;
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
