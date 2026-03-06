import { ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";
import {
	type RunHistoryEntry,
	formatDuration,
	formatTimestamp,
} from "./run-history";

export const VIEW_TYPE_CLAUDE_OUTPUT = "claude-vault-output";

const RENDER_DEBOUNCE_MS = 50;

export type RunStatus = "idle" | "running" | "complete" | "error" | "stopped" | "limit";
export type ActiveTab = "output" | "history";

/** Module-level state so status persists across view re-opens. */
let persistedStatus: RunStatus = "idle";
let persistedStatusText = "";

export function getPersistedStatus(): { status: RunStatus; text: string } {
	return { status: persistedStatus, text: persistedStatusText };
}

export function resetPersistedStatus(): void {
	persistedStatus = "idle";
	persistedStatusText = "";
}

export class ClaudeOutputView extends ItemView {
	private outputEl: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;
	private markdownEl: HTMLElement | null = null;
	private markdownContent = "";
	private renderTimer: ReturnType<typeof setTimeout> | null = null;
	private headerEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private stopBtn: HTMLElement | null = null;
	private onStop: (() => void) | null = null;

	private tabBarEl: HTMLElement | null = null;
	private outputTab: HTMLElement | null = null;
	private historyTab: HTMLElement | null = null;
	private outputPane: HTMLElement | null = null;
	private historyPane: HTMLElement | null = null;
	private activeTab: ActiveTab = "output";

	private historyEntries: RunHistoryEntry[] = [];
	private onClearHistory: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CLAUDE_OUTPUT;
	}

	getDisplayText(): string {
		return "Claude Output";
	}

	getIcon(): string {
		return "terminal";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("claude-output-container");

		this.headerEl = container.createDiv({ cls: "claude-output-header" });
		this.statusEl = this.headerEl.createEl("span", {
			cls: "claude-output-status-badge",
		});
		this.stopBtn = this.headerEl.createEl("button", {
			text: "Stop",
			cls: "claude-output-stop-btn",
		});
		this.stopBtn.addEventListener("click", () => {
			if (this.onStop) this.onStop();
		});

		// Tab buttons inline in the header
		this.tabBarEl = this.headerEl.createDiv({ cls: "claude-output-tab-bar" });
		this.outputTab = this.tabBarEl.createEl("button", {
			text: "Output",
			cls: "claude-output-tab claude-output-tab-active",
		});
		this.historyTab = this.tabBarEl.createEl("button", {
			text: "History",
			cls: "claude-output-tab",
		});
		this.outputTab.addEventListener("click", () => this.switchTab("output"));
		this.historyTab.addEventListener("click", () => this.switchTab("history"));

		// Output pane (existing content area)
		this.outputPane = container.createDiv({ cls: "claude-output-pane" });

		this.errorEl = this.outputPane.createDiv({ cls: "claude-output-error" });
		this.errorEl.hide();

		this.outputEl = this.outputPane.createDiv({ cls: "claude-output-content" });
		this.outputEl.addEventListener("click", (evt) => {
			this.handleInternalLinkClick(evt);
		});

		// History pane
		this.historyPane = container.createDiv({ cls: "claude-output-pane claude-output-history-pane" });
		this.historyPane.hide();

		// Restore persisted status
		this.renderStatus(persistedStatus);
		this.renderHistoryList();
	}

	async onClose(): Promise<void> {
		if (this.renderTimer) {
			clearTimeout(this.renderTimer);
			this.renderTimer = null;
		}
		this.outputEl = null;
		this.errorEl = null;
		this.markdownEl = null;
		this.markdownContent = "";
		this.headerEl = null;
		this.statusEl = null;
		this.stopBtn = null;
		this.tabBarEl = null;
		this.outputTab = null;
		this.historyTab = null;
		this.outputPane = null;
		this.historyPane = null;
	}

	setOnStop(callback: () => void): void {
		this.onStop = callback;
	}

	setOnClearHistory(callback: () => void): void {
		this.onClearHistory = callback;
	}

	setStatus(status: RunStatus): void {
		persistedStatus = status;
		this.renderStatus(status);
	}

	getStatus(): RunStatus {
		return persistedStatus;
	}

	getActiveTab(): ActiveTab {
		return this.activeTab;
	}

	setHistory(entries: RunHistoryEntry[]): void {
		this.historyEntries = entries;
		this.renderHistoryList();
	}

	switchTab(tab: ActiveTab): void {
		this.activeTab = tab;
		if (tab === "output") {
			this.outputPane?.show();
			this.historyPane?.hide();
			this.outputTab?.addClass("claude-output-tab-active");
			this.historyTab?.removeClass("claude-output-tab-active");
		} else {
			this.outputPane?.hide();
			this.historyPane?.show();
			this.outputTab?.removeClass("claude-output-tab-active");
			this.historyTab?.addClass("claude-output-tab-active");
			this.renderHistoryList();
		}
	}

	private renderHistoryList(): void {
		if (!this.historyPane) return;
		this.historyPane.empty();

		if (this.historyEntries.length === 0) {
			this.historyPane.createDiv({
				text: "No run history yet.",
				cls: "claude-history-empty",
			});
			return;
		}

		// Clear history button
		const toolbar = this.historyPane.createDiv({ cls: "claude-history-toolbar" });
		const clearBtn = toolbar.createEl("button", {
			text: "Clear History",
			cls: "claude-history-clear-btn",
		});
		clearBtn.addEventListener("click", () => {
			if (this.onClearHistory) {
				this.onClearHistory();
				this.renderHistoryList();
			}
		});

		const list = this.historyPane.createDiv({ cls: "claude-history-list" });

		for (const entry of this.historyEntries) {
			const item = list.createDiv({ cls: "claude-history-item" });

			const header = item.createDiv({ cls: "claude-history-item-header" });
			header.createEl("span", {
				text: entry.promptName,
				cls: "claude-history-item-name",
			});
			header.createEl("span", {
				text: entry.scope === "note" ? "Note" : "Vault",
				cls: `claude-history-item-scope claude-scope-${entry.scope}`,
			});

			const meta = item.createDiv({ cls: "claude-history-item-meta" });
			const parts: string[] = [formatTimestamp(entry.timestamp)];
			parts.push(formatDuration(entry.durationMs));
			if (entry.costUsd !== undefined) {
				parts.push(`$${entry.costUsd.toFixed(4)}`);
			}
			meta.createEl("span", {
				text: parts.join(" · "),
				cls: "claude-history-item-info",
			});
			if (entry.notePath) {
				meta.createEl("span", {
					text: entry.notePath,
					cls: "claude-history-item-note",
				});
			}

			header.createEl("span", {
				text: entry.status,
				cls: `claude-history-item-status claude-history-status-${entry.status}`,
			});

			item.addEventListener("click", () => {
				this.showHistoryEntry(entry);
			});
		}
	}

	private showHistoryEntry(entry: RunHistoryEntry): void {
		this.switchTab("output");
		this.clear();

		const scopeLabel = entry.scope === "note" ? "note" : "vault";
		const statusText = `"${entry.promptName}" (${scopeLabel}) — ${formatTimestamp(entry.timestamp)}`;
		this.showStatus(statusText);

		if (entry.output) {
			this.appendText(entry.output);
			this.flushRender();
		}

		if (entry.costUsd !== undefined || entry.durationMs) {
			this.showResult(entry.costUsd, entry.durationMs);
		}
	}

	private renderStatus(status: RunStatus): void {
		if (!this.statusEl || !this.stopBtn) return;

		const labels: Record<RunStatus, string> = {
			idle: "Idle",
			running: "Running",
			complete: "Complete",
			error: "Error",
			stopped: "Stopped",
			limit: "Limit Reached",
		};

		this.statusEl.textContent = labels[status];
		this.statusEl.className = `claude-output-status-badge claude-status-${status}`;

		if (status === "running") {
			this.stopBtn.show();
		} else {
			this.stopBtn.hide();
		}
	}

	clear(): void {
		if (this.outputEl) {
			this.outputEl.empty();
		}
		if (this.errorEl) {
			this.errorEl.hide();
			this.errorEl.empty();
		}
		if (this.renderTimer) {
			clearTimeout(this.renderTimer);
			this.renderTimer = null;
		}
		this.markdownEl = null;
		this.markdownContent = "";
	}

	showStatus(message: string): void {
		if (!this.outputEl) return;
		persistedStatusText = message;
		this.outputEl.createDiv({
			text: message,
			cls: "claude-output-status",
		});
		this.scrollToBottom();
	}

	appendText(text: string): void {
		if (!this.outputEl) return;

		if (!this.markdownEl) {
			this.markdownEl = this.outputEl.createDiv({
				cls: "claude-output-markdown",
			});
		}

		this.markdownContent += text;
		this.scheduleRender();
	}

	showToolUse(toolName: string, filePath?: string, input?: Record<string, unknown>): void {
		if (!this.outputEl) return;
		this.flushRender();
		this.markdownEl = null;
		this.markdownContent = "";

		const details = this.outputEl.createEl("details", {
			cls: "claude-tool-call",
		});

		const summary = details.createEl("summary", {
			cls: "claude-tool-call-summary",
		});
		summary.createEl("span", {
			text: toolName,
			cls: "claude-tool-call-name",
		});
		if (filePath) {
			summary.createEl("span", {
				text: filePath,
				cls: "claude-tool-call-path",
			});
		}

		if (input && Object.keys(input).length > 0) {
			const body = details.createDiv({ cls: "claude-tool-call-input" });
			const filtered = this.filterToolInput(toolName, input);
			body.createEl("pre", {
				text: JSON.stringify(filtered, null, 2),
			});
		}

		this.scrollToBottom();
	}

	private filterToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
		// For Write/Edit, omit large content/new_string fields to keep display concise
		const omitKeys: Record<string, string[]> = {
			Write: ["content"],
			Edit: ["new_string", "old_string"],
		};
		const keysToOmit = omitKeys[toolName];
		if (!keysToOmit) return input;

		const filtered: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(input)) {
			if (keysToOmit.includes(key) && typeof value === "string") {
				filtered[key] = `(${value.length} chars)`;
			} else {
				filtered[key] = value;
			}
		}
		return filtered;
	}

	showResult(costUsd?: number, durationMs?: number): void {
		if (!this.outputEl) return;
		this.flushRender();
		this.markdownEl = null;
		this.markdownContent = "";

		if (costUsd !== undefined || durationMs !== undefined) {
			const parts: string[] = [];
			if (costUsd !== undefined) parts.push(`$${costUsd.toFixed(4)}`);
			if (durationMs !== undefined) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
			this.outputEl.createEl("div", {
				text: parts.join(" · "),
				cls: "claude-output-stats",
			});
		}
		this.scrollToBottom();
	}

	showError(message: string): void {
		if (!this.errorEl) return;
		this.errorEl.setText(message);
		this.errorEl.show();
		this.scrollToBottom();
	}

	showExitCode(code: number | null): void {
		if (!this.outputEl) return;
		this.flushRender();
		if (code !== null && code !== 0) {
			this.outputEl.createEl("div", {
				text: `\nProcess exited with code ${code}`,
				cls: "claude-output-exit-error",
			});
		}
		this.scrollToBottom();
	}

	private scheduleRender(): void {
		if (this.renderTimer) return;
		this.renderTimer = setTimeout(() => {
			this.renderTimer = null;
			this.renderMarkdown();
		}, RENDER_DEBOUNCE_MS);
	}

	private flushRender(): void {
		if (this.renderTimer) {
			clearTimeout(this.renderTimer);
			this.renderTimer = null;
			this.renderMarkdown();
		}
	}

	private renderMarkdown(): void {
		if (!this.markdownEl || !this.markdownContent) return;
		this.markdownEl.empty();
		MarkdownRenderer.render(
			this.app,
			this.markdownContent,
			this.markdownEl,
			"/",
			this
		);
		this.scrollToBottom();
	}

	private handleInternalLinkClick(evt: MouseEvent): void {
		const target = evt.target as HTMLElement;
		const link = target.closest("a.internal-link") as HTMLAnchorElement | null;
		if (!link) return;

		evt.preventDefault();
		const href = link.getAttr("href");
		if (href) {
			this.app.workspace.openLinkText(href, "/", true);
		}
	}

	private scrollToBottom(): void {
		if (this.outputEl) {
			this.outputEl.scrollTop = this.outputEl.scrollHeight;
		}
	}
}
