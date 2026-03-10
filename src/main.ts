import { Notice, Plugin } from "obsidian";
import {
	ClaudeVaultSettingTab,
	DEFAULT_SETTINGS,
	parseSettings,
	type PluginSettings,
} from "./settings";
import { ClaudeRunner, ClaudeRunnerError, type RunScope } from "./claude-runner";
import { scanPromptFiles, readPromptContent } from "./prompt-scanner";
import { PromptPickerModal, ScopePickerModal } from "./prompt-picker";
import { AdhocPromptModal } from "./adhoc-prompt-modal";
import { ClaudeOutputView, VIEW_TYPE_CLAUDE_OUTPUT } from "./output-view";
import { StreamLineBuffer, parseStreamLine } from "./stream-parser";
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
	runner: ClaudeRunner = new ClaudeRunner();
	private ribbonIconEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ClaudeVaultSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_CLAUDE_OUTPUT,
			(leaf) => new ClaudeOutputView(leaf)
		);

		this.ribbonIconEl = this.addRibbonIcon(
			"bot",
			"Run Claude prompt",
			() => this.openScopePickerAndRun()
		);

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
				if (!this.runner.isRunning) return false;
				if (!checking) {
					this.runner.stop();
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
	}

	onunload() {}

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
			(scope) => { void this.openPickerAndRun(scope); }
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
					void this.executeRun(scope, name, promptText);
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
		rawPromptContent: string
	): Promise<void> {
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
			this.runner.stop();
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

		try {
			const child = this.runner.run({
				vaultPath,
				promptContent,
				settings: runSettings,
				scope,
				activeNotePath,
				systemPrompt,
			});

			const refresher = new VaultRefresher();
			let lastStopReason: string | undefined;

			const lineBuffer = new StreamLineBuffer((line) => {
				const event = parseStreamLine(line);
				if (!event) return;
				switch (event.type) {
					case "text":
						view.appendText(event.text);
						accumulatedOutput += event.text;
						break;
					case "tool_use":
						view.showToolUse(event.name, event.filePath, event.input);
						refresher.trackToolUse(event.name, event.filePath);
						break;
					case "result":
						lastStopReason = event.stopReason;
						lastCostUsd = event.costUsd;
						view.showResult(event.costUsd, event.durationMs);
						break;
				}
			});

			child.stdout?.on("data", (chunk: Buffer) => {
				lineBuffer.push(chunk.toString());
			});

			child.stderr?.on("data", (chunk: Buffer) => {
				view.showError(chunk.toString());
			});

			child.on("close", (code: number | null) => {
				lineBuffer.flush();
				view.showExitCode(code);
				this.setRibbonRunning(false);

				const durationMs = Date.now() - runStartTime;
				const durationSec = (durationMs / 1000).toFixed(1);
				let status: string;
				let historyStatus: RunHistoryEntry["status"];

				// Only update status if not already stopped by user
				if (view.getStatus() !== "stopped") {
					const isLimit = lastStopReason === "max_turns" || lastStopReason === "budget_exceeded";
					if (isLimit) {
						const reason = lastStopReason === "max_turns" ? "max turns" : "budget";
						view.showStatus(`Run stopped: ${reason} limit reached.`);
						view.setStatus("limit");
						status = "limit reached";
						historyStatus = "limit";
					} else if (code === 0 || code === null) {
						view.setStatus("complete");
						status = "complete";
						historyStatus = "success";
					} else {
						view.setStatus("error");
						status = "error";
						historyStatus = "error";
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
					notePath: activeNotePath,
					output: accumulatedOutput,
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
			});

			child.on("runner-error", (err: Error) => {
				view.showError(err.message);
				view.setStatus("error");
				this.setRibbonRunning(false);
			});
		} catch (err) {
			if (err instanceof ClaudeRunnerError) {
				view.showError(err.message);
				view.setStatus("error");
			} else {
				throw err;
			}
		}
	}

	private notifyRunComplete(promptName: string, status: string, durationSec: string): void {
		const message = `"${promptName}" ${status} (${durationSec}s)`;
		new Notice(message);

		// System notification when Obsidian is not focused
		if (!document.hasFocus() && typeof Notification !== "undefined") {
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
