import { Notice, Plugin } from "obsidian";
import {
	ClaudeVaultSettingTab,
	DEFAULT_SETTINGS,
	parseSettings,
	type PluginSettings,
} from "./settings";
import { buildPromptText, type RunScope } from "./run-types";
import { scanPromptFiles, readPromptContent } from "./prompt-scanner";
import { PromptPickerModal, ScopePickerModal } from "./prompt-picker";
import { ClaudeHistoryView, VIEW_TYPE_CLAUDE_HISTORY } from "./history-view";
import {
	ClaudeChatView,
	VIEW_TYPE_CLAUDE_CHAT,
	type ChatViewDeps,
} from "./chat-view";
import { ActivityLock } from "./activity-lock";
import { parsePromptFrontmatter, mergeOverrides, hasOverrides } from "./frontmatter";
import { type RunHistoryEntry, upsertEntry } from "./run-history";

interface PluginData {
	settings: PluginSettings;
	history: RunHistoryEntry[];
}

export default class ClaudeVaultAssistant extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	history: RunHistoryEntry[] = [];
	/** Shared gate so two chat turns never run at the same time. */
	lock: ActivityLock = new ActivityLock();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ClaudeVaultSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_CLAUDE_HISTORY, (leaf) => {
			const view = new ClaudeHistoryView(leaf);
			// Wire here, not just in activateHistoryView: a pane restored from a
			// saved workspace layout never goes through activate, and without the
			// callbacks it has no entries and no resume action.
			this.wireHistoryCallbacks(view);
			return view;
		});

		this.registerView(VIEW_TYPE_CLAUDE_CHAT, (leaf) => {
			const view = new ClaudeChatView(leaf);
			view.setDeps(this.chatDeps());
			return view;
		});

		this.addRibbonIcon(
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

		// Keeps the historical "open-output" id so existing hotkeys still work.
		this.addCommand({
			id: "open-output",
			name: "Open Claude history",
			callback: () => {
				void this.activateHistoryView();
			},
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
				void this.launchPromptChat(scope, result.name, result.content);
			},
			overridesMap
		);
		picker.open();
	}

	/**
	 * Start a chat session from a PROMPT-*.md file: frontmatter overrides merge
	 * over the plugin settings, the prompt body auto-submits as the first
	 * message, and the conversation continues interactively in the chat view.
	 */
	private async launchPromptChat(
		scope: RunScope,
		promptName: string,
		rawPromptContent: string
	): Promise<void> {
		if (this.lock.isBusy) {
			new Notice(`Claude is busy: ${this.lock.label ?? "another run"}.`);
			return;
		}

		const { content: promptContent, overrides } =
			parsePromptFrontmatter(rawPromptContent);
		const runSettings = hasOverrides(overrides)
			? mergeOverrides(this.settings, overrides)
			: this.settings;

		let notePath: string | undefined;
		if (scope === "note") {
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				new Notice("No active note.");
				return;
			}
			notePath = activeFile.path;
		}

		let message: string;
		try {
			message = buildPromptText(scope, promptContent, notePath);
		} catch (err) {
			new Notice(err instanceof Error ? err.message : String(err));
			return;
		}

		let extraSystemPrompt: string | undefined;
		const claudeMdFile = this.app.vault.getFileByPath("CLAUDE.md");
		if (claudeMdFile) {
			extraSystemPrompt = await this.app.vault.read(claudeMdFile);
		}

		const view = await this.activateChatView();
		if (!view) {
			new Notice("Could not open Claude chat pane.");
			return;
		}

		await view.startPromptChat({
			promptName,
			scope,
			message,
			settings: runSettings,
			notePath,
			extraSystemPrompt,
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

	/** Insert or update a chat session's history entry and persist it. */
	private saveHistoryEntry(entry: RunHistoryEntry): void {
		this.history = upsertEntry(
			this.history,
			entry,
			this.settings.maxHistoryEntries
		);
		this.saveHistory().catch((err) => {
			console.error("Failed to save run history:", err);
		});
		this.refreshHistoryViews();
	}

	/** Re-render any open history panes from the current history array. */
	private refreshHistoryViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_HISTORY)) {
			const view = leaf.view;
			if (view instanceof ClaudeHistoryView) {
				view.refresh();
			}
		}
	}

	async activateHistoryView(): Promise<ClaudeHistoryView | null> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_HISTORY);
		if (existing.length > 0) {
			const leaf = existing[0]!;
			await this.app.workspace.revealLeaf(leaf);
			const view = leaf.view as ClaudeHistoryView;
			this.wireHistoryCallbacks(view);
			return view;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({
			type: VIEW_TYPE_CLAUDE_HISTORY,
			active: true,
		});
		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view as ClaudeHistoryView;
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
			getActiveNotePath: () =>
				this.app.workspace.getActiveFile()?.path ?? null,
			onActiveNoteChange: (cb) => {
				const ref = this.app.workspace.on("active-leaf-change", () => cb());
				return () => this.app.workspace.offref(ref);
			},
			saveHistoryEntry: (entry) => this.saveHistoryEntry(entry),
			openHistory: () => {
				void this.activateHistoryView();
			},
			notifyRunComplete: (name, status, durationSec) =>
				this.notifyRunComplete(name, status, durationSec),
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

	private wireHistoryCallbacks(view: ClaudeHistoryView): void {
		// Pull-based: the view reads the live array on every render, so it shows
		// current history no matter when Obsidian constructs it.
		view.setHistorySource(() => this.history);
		view.setOnClearHistory(() => {
			this.history = [];
			this.refreshHistoryViews();
			this.saveHistory().catch((err) => {
				console.error("Failed to save cleared history:", err);
			});
		});
		view.setOnResume((entry) => {
			void this.activateChatView().then((chat) => {
				if (chat) void chat.resumeFromHistory(entry);
			});
		});
	}
}
