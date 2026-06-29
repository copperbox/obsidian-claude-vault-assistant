import { Notice, Plugin } from "obsidian";
import {
	ClaudeVaultSettingTab,
	DEFAULT_SETTINGS,
	parseSettings,
	type PluginSettings,
} from "./settings";
import { PromptRunner } from "./prompt-runner";
import type { RunScope } from "./run-types";
import { scanPromptFiles, readPromptContent } from "./prompt-scanner";
import { PromptPickerModal, ScopePickerModal } from "./prompt-picker";
import { AdhocPromptModal } from "./adhoc-prompt-modal";
import { ClaudeOutputView, VIEW_TYPE_CLAUDE_OUTPUT } from "./output-view";
import {
	ClaudeChatView,
	VIEW_TYPE_CLAUDE_CHAT,
	type ChatViewDeps,
} from "./chat-view";
import { ActivityLock } from "./activity-lock";
import { VaultRefresher } from "./vault-refresher";
import { parsePromptFrontmatter, mergeOverrides, hasOverrides } from "./frontmatter";
import {
	type RunHistoryEntry,
	addEntry,
	generateEntryId,
} from "./run-history";

interface PluginData {
	settings: PluginSettings;
	history: RunHistoryEntry[];
}

export default class ClaudeVaultAssistant extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	history: RunHistoryEntry[] = [];
	promptRunner: PromptRunner = new PromptRunner();
	/** Shared gate so a one-off run and a chat turn never run at the same time. */
	lock: ActivityLock = new ActivityLock();
	private ribbonIconEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ClaudeVaultSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_CLAUDE_OUTPUT,
			(leaf) => new ClaudeOutputView(leaf)
		);

		this.registerView(VIEW_TYPE_CLAUDE_CHAT, (leaf) => {
			const view = new ClaudeChatView(leaf);
			view.setDeps(this.chatDeps());
			return view;
		});

		this.ribbonIconEl = this.addRibbonIcon(
			"bot",
			"Run Claude prompt",
			() => this.openScopePickerAndRun()
		);

		this.addRibbonIcon("message-square", "Open Claude chat", () => {
			void this.activateChatView();
		});

		this.addCommand({
			id: "run-vault-prompt",
			name: "Run Claude prompt (vault)",
			callback: () => this.openPickerAndRun("vault"),
		});

		this.addCommand({
			id: "run-note-prompt",
			name: "Run Claude prompt (active note)",
			checkCallback: (checking) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) return false;
				if (!checking) {
					void this.openPickerAndRun("note");
				}
				return true;
			},
		});

		this.addCommand({
			id: "stop-claude",
			name: "Stop Claude",
			checkCallback: (checking) => {
				if (!this.promptRunner.isRunning) return false;
				if (!checking) {
					this.promptRunner.stop();
					new Notice("Claude run stopped.");
				}
				return true;
			},
		});

		this.addCommand({
			id: "run-adhoc-prompt",
			name: "Run ad-hoc Claude prompt",
			callback: () => this.openAdhocPrompt(),
		});

		this.addCommand({
			id: "open-output",
			name: "Open Claude output",
			callback: () => this.activateOutputView(),
		});

		this.addCommand({
			id: "open-chat",
			name: "Open Claude chat",
			callback: () => {
				void this.activateChatView();
			},
		});
	}

	onunload() {
		// Tear down any live chat subprocess so it doesn't outlive the plugin.
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CHAT)) {
			const view = leaf.view;
			if (view instanceof ClaudeChatView) {
				void view.shutdown();
			}
		}
	}

	private setRibbonRunning(running: boolean): void {
		if (!this.ribbonIconEl) return;
		if (running) {
			this.ribbonIconEl.addClass("claude-ribbon-running");
		} else {
			this.ribbonIconEl.removeClass("claude-ribbon-running");
		}
	}

	async loadSettings() {
		const raw: unknown = await this.loadData();
		if (raw && typeof raw === "object" && "settings" in raw) {
			const data = raw as PluginData;
			this.settings = parseSettings(data.settings);
			this.history = Array.isArray(data.history) ? data.history : [];
		} else {
			// Migration from old format where data IS settings
			this.settings = parseSettings(raw);
			this.history = [];
		}
	}

	async saveSettings() {
		await this.savePluginData();
	}

	async saveHistory() {
		await this.savePluginData();
	}

	private async savePluginData() {
		const data: PluginData = {
			settings: this.settings,
			history: this.history,
		};
		await this.saveData(data);
	}

	private openScopePickerAndRun(): void {
		const hasActiveNote = !!this.app.workspace.getActiveFile();
		const picker = new ScopePickerModal(
			this.app,
			hasActiveNote,
			(scope) => { void this.openPickerAndRun(scope); },
			() => { void this.activateChatView(); }
		);
		picker.open();
	}

	private openAdhocPrompt(): void {
		const hasActiveNote = !!this.app.workspace.getActiveFile();
		const picker = new ScopePickerModal(
			this.app,
			hasActiveNote,
			(scope) => {
				const modal = new AdhocPromptModal(this.app, (promptText) => {
					const name =
						promptText.length > 40
							? promptText.slice(0, 40) + "…"
							: promptText;
					void this.executeRun(scope, name, promptText, promptText);
				});
				modal.open();
			}
		);
		picker.open();
	}

	private async openPickerAndRun(scope: RunScope): Promise<void> {
		const prompts = scanPromptFiles(this.app.vault);
		if (prompts.length === 0) {
			new Notice("No PROMPT-*.md files found in vault root.");
			return;
		}

		// Pre-scan frontmatter for override badges in the picker
		const overridesMap = new Map<string, import("./frontmatter").PromptOverrides>();
		for (const prompt of prompts) {
			try {
				const raw = await readPromptContent(this.app.vault, prompt.path);
				const { overrides } = parsePromptFrontmatter(raw);
				if (hasOverrides(overrides)) {
					overridesMap.set(prompt.path, overrides);
				}
			} catch {
				// Skip prompts that can't be read
			}
		}

		const picker = new PromptPickerModal(
			this.app,
			prompts,
			(path) => readPromptContent(this.app.vault, path),
			(result) => {
				void this.executeRun(scope, result.name, result.content);
			},
			overridesMap
		);
		picker.open();
	}

	private async executeRun(
		scope: RunScope,
		promptName: string,
		rawPromptContent: string,
		adhocPrompt?: string
	): Promise<void> {
		if (this.lock.isBusy) {
			new Notice(`Claude is busy: ${this.lock.label ?? "another run"}.`);
			return;
		}

		const view = await this.activateOutputView();
		if (!view) {
			new Notice("Could not open Claude output pane.");
			return;
		}

		const { content: promptContent, overrides } = parsePromptFrontmatter(rawPromptContent);
		const runSettings = hasOverrides(overrides)
			? mergeOverrides(this.settings, overrides)
			: this.settings;

		view.clear();
		view.switchTab("output");
		view.setOnStop(() => {
			// Deny any pending permission prompt so the awaited canUseTool
			// resolves and stop() can unwind the in-flight turn.
			view.cancelPendingPermissions("deny");
			this.promptRunner.stop();
			view.setStatus("stopped");
			this.setRibbonRunning(false);
			new Notice("Claude run stopped.");
		});
		view.setStatus("running");
		this.setRibbonRunning(true);
		const scopeLabel = scope === "note" ? "note" : "vault";
		const runStartTime = Date.now();
		view.showStatus(`Running "${promptName}" (${scopeLabel})…`);

		const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath;
		if (!vaultPath) {
			new Notice("Could not determine vault path.");
			return;
		}

		let activeNotePath: string | undefined;

		if (scope === "note") {
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				new Notice("No active note.");
				return;
			}
			activeNotePath = activeFile.path;
		}

		let systemPrompt: string | undefined;
		const claudeMdFile = this.app.vault.getFileByPath("CLAUDE.md");
		if (claudeMdFile) {
			systemPrompt = await this.app.vault.read(claudeMdFile);
		}

		// Accumulate output text for history
		let accumulatedOutput = "";
		let lastCostUsd: number | undefined;
		let lastTokens: number | undefined;

		if (!this.lock.tryAcquire(`Prompt: ${promptName}`)) {
			new Notice(`Claude is busy: ${this.lock.label ?? "another run"}.`);
			view.setStatus("idle");
			this.setRibbonRunning(false);
			return;
		}

		const refresher = new VaultRefresher();

		void this.promptRunner.run(
			{
				vaultPath,
				settings: runSettings,
				scope,
				promptBody: promptContent,
				activeNotePath,
				extraSystemPrompt: systemPrompt,
				requestPermission: (req) => view.promptPermission(req),
			},
			{
				onAssistantText: (text) => {
					view.appendText(text);
					accumulatedOutput += text;
					if (!text.endsWith("\n")) {
						accumulatedOutput += "\n\n";
					}
				},
				onToolUse: (tool) => {
					view.showToolUse(tool.name, tool.filePath, tool.input, tool.id);
					refresher.trackToolUse(tool.name, tool.filePath);
				},
				onToolResult: (result) => {
					view.showToolResult(result.toolUseId, result.isError, result.content);
				},
				onResult: (result) => {
					lastCostUsd = result.costUsd;
					lastTokens = result.tokens;
					view.showResult(result.costUsd, result.durationMs, result.tokens);
				},
				onError: (message) => {
					view.showError(message);
				},
				onComplete: (outcome) => {
					this.setRibbonRunning(false);
					this.lock.release();
					view.cancelPendingPermissions("deny");

					const durationMs = Date.now() - runStartTime;
					const durationSec = (durationMs / 1000).toFixed(1);
					let status: string;
					let historyStatus: RunHistoryEntry["status"];

					// Preserve a user-initiated stop; otherwise map the outcome.
					if (view.getStatus() !== "stopped" && outcome.status !== "stopped") {
						if (outcome.status === "limit") {
							const reason =
								outcome.limit === "max_turns" ? "max turns" : "budget";
							view.showStatus(`Run stopped: ${reason} limit reached.`);
							view.setStatus("limit");
							status = "limit reached";
							historyStatus = "limit";
						} else if (outcome.status === "error") {
							view.setStatus("error");
							status = "error";
							historyStatus = "error";
						} else {
							view.setStatus("complete");
							status = "complete";
							historyStatus = "success";
						}
						this.notifyRunComplete(promptName, status, durationSec);
					} else {
						historyStatus = "stopped";
					}

					// Record history entry
					const entry: RunHistoryEntry = {
						id: generateEntryId(),
						promptName,
						scope,
						timestamp: runStartTime,
						durationMs,
						status: historyStatus,
						costUsd: lastCostUsd,
						tokens: lastTokens,
						notePath: activeNotePath,
						output: accumulatedOutput,
						...(adhocPrompt !== undefined ? { prompt: adhocPrompt } : {}),
					};
					this.history = addEntry(
						this.history,
						entry,
						this.settings.maxHistoryEntries
					);
					view.setHistory(this.history);
					this.saveHistory().catch((err) => {
						console.error("Failed to save run history:", err);
					});

					// Refresh any files modified by Claude
					refresher.refreshModifiedFiles(this.app).catch((err) => {
						console.error("Failed to refresh vault files:", err);
					});
				},
			}
		).catch((err) => {
			// PromptRunner.run reports run failures via onError/onComplete; this
			// only guards an unexpected rejection so the lock is never stuck.
			this.setRibbonRunning(false);
			this.lock.release();
			view.cancelPendingPermissions("deny");
			view.showError(err instanceof Error ? err.message : String(err));
			view.setStatus("error");
		});
	}

	private notifyRunComplete(promptName: string, status: string, durationSec: string): void {
		const message = `"${promptName}" ${status} (${durationSec}s)`;
		new Notice(message);

		// System notification when Obsidian is not focused
		if (!activeDocument.hasFocus() && typeof Notification !== "undefined") {
			try {
				new Notification("Claude Vault Assistant", { body: message });
			} catch {
				// Notifications may not be available in all environments
			}
		}
	}

	async activateOutputView(): Promise<ClaudeOutputView | null> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_OUTPUT);
		if (existing.length > 0) {
			const leaf = existing[0]!;
			await this.app.workspace.revealLeaf(leaf);
			const view = leaf.view as ClaudeOutputView;
			this.wireHistoryCallbacks(view);
			return view;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({
			type: VIEW_TYPE_CLAUDE_OUTPUT,
			active: true,
		});
		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view as ClaudeOutputView;
		this.wireHistoryCallbacks(view);
		return view;
	}

	private getVaultPath(): string | null {
		return (
			(this.app.vault.adapter as { basePath?: string }).basePath ?? null
		);
	}

	private chatDeps(): ChatViewDeps {
		return {
			getSettings: () => this.settings,
			getVaultPath: () => this.getVaultPath(),
			lock: this.lock,
		};
	}

	async activateChatView(): Promise<ClaudeChatView | null> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CHAT);
		if (existing.length > 0) {
			const leaf = existing[0]!;
			await this.app.workspace.revealLeaf(leaf);
			const view = leaf.view as ClaudeChatView;
			view.setDeps(this.chatDeps());
			return view;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({
			type: VIEW_TYPE_CLAUDE_CHAT,
			active: true,
		});
		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view as ClaudeChatView;
		view.setDeps(this.chatDeps());
		return view;
	}

	private wireHistoryCallbacks(view: ClaudeOutputView): void {
		view.setHistory(this.history);
		view.setOnClearHistory(() => {
			this.history = [];
			view.setHistory(this.history);
			this.saveHistory().catch((err) => {
				console.error("Failed to save cleared history:", err);
			});
		});
	}
}
