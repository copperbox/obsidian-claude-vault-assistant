import { App, PluginSettingTab, Setting } from "obsidian";
import type ClaudeVaultAssistant from "./main";

/** Effort levels the Agent SDK accepts; "" means let the SDK/CLI decide. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export type EffortSetting = "" | EffortLevel;

/**
 * Permission modes exposed by the plugin. Deliberately excludes
 * "bypassPermissions" (skips the permission cards entirely) and "dontAsk"
 * (silently denies everything not whitelisted).
 */
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto"] as const;
export type ChatPermissionMode = (typeof PERMISSION_MODES)[number];

export const PERMISSION_MODE_LABELS: Record<ChatPermissionMode, string> = {
	default: "Prompt (default)",
	acceptEdits: "Accept edits",
	plan: "Plan",
	auto: "Auto",
};

export const EFFORT_LABELS: Record<EffortSetting, string> = {
	"": "Default",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "xHigh",
	max: "Max",
};

export interface PluginSettings {
	allowedTools: string[];
	cliPath: string;
	maxTurns: number;
	maxBudget: number | null;
	modelOverride: string;
	maxHistoryEntries: number;
	/** Default reasoning effort for new sessions; "" = SDK default. */
	effort: EffortSetting;
	/** Default permission mode for new sessions. */
	permissionMode: ChatPermissionMode;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	allowedTools: ["Read", "Grep", "Glob", "Write", "Edit"],
	cliPath: "claude",
	maxTurns: 50,
	maxBudget: null,
	modelOverride: "",
	maxHistoryEntries: 50,
	effort: "",
	permissionMode: "default",
};

export function isEffortSetting(value: unknown): value is EffortSetting {
	return value === "" || EFFORT_LEVELS.includes(value as EffortLevel);
}

export function isPermissionMode(value: unknown): value is ChatPermissionMode {
	return PERMISSION_MODES.includes(value as ChatPermissionMode);
}

export function parseSettings(data: unknown): PluginSettings {
	const merged = Object.assign(
		{},
		DEFAULT_SETTINGS,
		data as Partial<PluginSettings>
	);
	// Sanitize enum-ish fields loaded from disk (older data, hand edits).
	if (!isEffortSetting(merged.effort)) merged.effort = DEFAULT_SETTINGS.effort;
	if (!isPermissionMode(merged.permissionMode)) {
		merged.permissionMode = DEFAULT_SETTINGS.permissionMode;
	}
	return merged;
}

export class ClaudeVaultSettingTab extends PluginSettingTab {
	plugin: ClaudeVaultAssistant;

	constructor(app: App, plugin: ClaudeVaultAssistant) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Allowed tools")
			.setDesc("Comma-separated list of tools Claude is allowed to use.")
			.addText((text) =>
				text
					.setPlaceholder("Read, Grep, Glob, Write, Edit")
					.setValue(this.plugin.settings.allowedTools.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.allowedTools = value
							.split(",")
							.map((t) => t.trim())
							.filter((t) => t.length > 0);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("CLI path")
			.setDesc("Path to the Claude CLI executable.")
			.addText((text) =>
				text
					.setPlaceholder("Claude")
					.setValue(this.plugin.settings.cliPath)
					.onChange(async (value) => {
						this.plugin.settings.cliPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max turns")
			.setDesc("Maximum number of agentic turns per run.")
			.addText((text) =>
				text
					.setPlaceholder("50")
					.setValue(String(this.plugin.settings.maxTurns))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0) {
							this.plugin.settings.maxTurns = parsed;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Max budget (USD)")
			.setDesc("Maximum cost per run in USD. Leave empty for no limit.")
			.addText((text) =>
				text
					.setPlaceholder("No limit")
					.setValue(
						this.plugin.settings.maxBudget !== null
							? String(this.plugin.settings.maxBudget)
							: ""
					)
					.onChange(async (value) => {
						if (value.trim() === "") {
							this.plugin.settings.maxBudget = null;
						} else {
							const parsed = parseFloat(value);
							if (!isNaN(parsed) && parsed > 0) {
								this.plugin.settings.maxBudget = parsed;
							}
						}
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Model override")
			.setDesc("Override the default Claude model. Leave empty to use the CLI default.")
			.addText((text) =>
				text
					.setPlaceholder("E.g. Sonnet, Opus, Haiku")
					.setValue(this.plugin.settings.modelOverride)
					.onChange(async (value) => {
						this.plugin.settings.modelOverride = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Effort")
			.setDesc(
				"Default reasoning effort for new sessions. Higher levels think longer; unsupported levels fall back per model."
			)
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(EFFORT_LABELS)) {
					dropdown.addOption(value, label);
				}
				dropdown
					.setValue(this.plugin.settings.effort)
					.onChange(async (value) => {
						if (isEffortSetting(value)) {
							this.plugin.settings.effort = value;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName("Permission mode")
			.setDesc(
				"Default permission mode for new sessions. Prompting asks before each non-whitelisted tool. Accept edits auto-approves file edits. Plan only plans without executing tools. Auto decides per action."
			)
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(PERMISSION_MODE_LABELS)) {
					dropdown.addOption(value, label);
				}
				dropdown
					.setValue(this.plugin.settings.permissionMode)
					.onChange(async (value) => {
						if (isPermissionMode(value)) {
							this.plugin.settings.permissionMode = value;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName("Max history entries")
			.setDesc("Maximum number of run history entries to keep. Oldest entries are pruned first.")
			.addText((text) =>
				text
					.setPlaceholder("50")
					.setValue(String(this.plugin.settings.maxHistoryEntries))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0) {
							this.plugin.settings.maxHistoryEntries = parsed;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
