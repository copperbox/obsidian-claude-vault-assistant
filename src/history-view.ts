import { ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";
import {
	type RunHistoryEntry,
	formatDuration,
	formatTimestamp,
} from "./run-history";
import { formatResultMeta } from "./format";
import { labelCodeBlocks } from "./code-block";

// Kept as "claude-vault-output" so workspace layouts saved before the output
// view became the history view still resolve to this pane.
export const VIEW_TYPE_CLAUDE_HISTORY = "claude-vault-output";

/**
 * Browsable archive of past sessions. Every chat session (prompt-launched or
 * manual) records one entry here; entries that carry a sessionId can be
 * resumed in the chat view.
 */
export class ClaudeHistoryView extends ItemView {
	private listEl: HTMLElement | null = null;
	private detailEl: HTMLElement | null = null;

	private entries: RunHistoryEntry[] = [];
	private onClearHistory: (() => void) | null = null;
	private onResume: ((entry: RunHistoryEntry) => void) | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CLAUDE_HISTORY;
	}

	getDisplayText(): string {
		return "Claude history";
	}

	getIcon(): string {
		return "history";
	}

	onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("claude-history-container");

		this.listEl = container.createDiv({
			cls: "claude-output-pane claude-output-history-pane",
		});
		this.detailEl = container.createDiv({
			cls: "claude-output-pane claude-history-detail",
		});
		this.detailEl.hide();

		this.renderList();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.listEl = null;
		this.detailEl = null;
		return Promise.resolve();
	}

	setHistory(entries: RunHistoryEntry[]): void {
		this.entries = entries;
		this.renderList();
	}

	setOnClearHistory(callback: () => void): void {
		this.onClearHistory = callback;
	}

	setOnResume(callback: (entry: RunHistoryEntry) => void): void {
		this.onResume = callback;
	}

	/** Return from the entry detail to the list (also refreshes the list). */
	showList(): void {
		this.detailEl?.hide();
		this.detailEl?.empty();
		this.listEl?.show();
		this.renderList();
	}

	private renderList(): void {
		if (!this.listEl) return;
		this.listEl.empty();

		if (this.entries.length === 0) {
			this.listEl.createDiv({
				text: "No session history yet.",
				cls: "claude-history-empty",
			});
			return;
		}

		const toolbar = this.listEl.createDiv({ cls: "claude-history-toolbar" });
		const clearBtn = toolbar.createEl("button", {
			text: "Clear history",
			cls: "claude-history-clear-btn",
		});
		clearBtn.addEventListener("click", () => {
			if (this.onClearHistory) {
				this.onClearHistory();
				this.renderList();
			}
		});

		const list = this.listEl.createDiv({ cls: "claude-history-list" });

		for (const entry of this.entries) {
			const item = list.createDiv({ cls: "claude-history-item" });

			const header = item.createDiv({ cls: "claude-history-item-header" });
			header.createSpan({
				text: entry.promptName,
				cls: "claude-history-item-name",
			});
			header.createSpan({
				text: entry.scope === "note" ? "Note" : "Vault",
				cls: `claude-history-item-scope claude-scope-${entry.scope}`,
			});

			const meta = item.createDiv({ cls: "claude-history-item-meta" });
			const parts: string[] = [formatTimestamp(entry.timestamp)];
			parts.push(formatDuration(entry.durationMs));
			if (entry.costUsd !== undefined) {
				parts.push(`$${entry.costUsd.toFixed(4)}`);
			}
			meta.createSpan({
				text: parts.join(" · "),
				cls: "claude-history-item-info",
			});
			if (entry.notePath) {
				meta.createSpan({
					text: entry.notePath,
					cls: "claude-history-item-note",
				});
			}

			header.createSpan({
				text: entry.status,
				cls: `claude-history-item-status claude-history-status-${entry.status}`,
			});

			item.addEventListener("click", () => {
				this.showEntry(entry);
			});
		}
	}

	private showEntry(entry: RunHistoryEntry): void {
		if (!this.detailEl) return;
		this.listEl?.hide();
		const detail = this.detailEl;
		detail.empty();
		detail.show();

		const toolbar = detail.createDiv({ cls: "claude-history-toolbar" });
		const backBtn = toolbar.createEl("button", {
			text: "Back",
			cls: "claude-history-back-btn",
		});
		backBtn.addEventListener("click", () => this.showList());
		if (entry.sessionId && this.onResume) {
			const resumeBtn = toolbar.createEl("button", {
				text: "Resume in chat",
				cls: "claude-history-resume-btn",
			});
			resumeBtn.addEventListener("click", () => {
				this.onResume?.(entry);
			});
		}

		const scopeLabel = entry.scope === "note" ? "note" : "vault";
		detail.createDiv({
			text: `"${entry.promptName}" (${scopeLabel}) — ${formatTimestamp(entry.timestamp)}`,
			cls: "claude-output-status",
		});

		if (entry.prompt) {
			const details = detail.createEl("details", {
				cls: "claude-history-prompt",
			});
			details.createEl("summary", {
				text: "Prompt",
				cls: "claude-history-prompt-summary",
			});
			details.createEl("pre", {
				text: entry.prompt,
				cls: "claude-history-prompt-body",
			});
		}

		if (entry.output) {
			const md = detail.createDiv({ cls: "claude-output-content" });
			md.addEventListener("click", (evt) => this.handleInternalLinkClick(evt));
			void MarkdownRenderer.render(this.app, entry.output, md, "/", this).then(
				() => labelCodeBlocks(md)
			);
		}

		const metaText = formatResultMeta({
			costUsd: entry.costUsd,
			durationMs: entry.durationMs,
			tokens: entry.tokens,
		});
		if (metaText) {
			detail.createDiv({ text: metaText, cls: "claude-output-stats" });
		}
	}

	private handleInternalLinkClick(evt: MouseEvent): void {
		const target = evt.target as HTMLElement;
		const link = target.closest("a.internal-link");
		if (!link) return;

		evt.preventDefault();
		const href = link.getAttr("href");
		if (href) {
			void this.app.workspace.openLinkText(href, "/", true);
		}
	}
}
