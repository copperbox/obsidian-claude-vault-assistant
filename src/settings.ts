import { App, PluginSettingTab, Setting } from "obsidian";
import type ClaudeVaultAssistant from "./main";

export interface PluginSettings {
	allowedTools: string[];
	cliPath: string;
	maxTurns: number;
	maxBudget: number | null;
	modelOverride: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	allowedTools: ["Read", "Grep", "Glob", "Write", "Edit"],
	cliPath: "claude",
	maxTurns: 50,
	maxBudget: null,
	modelOverride: "",
};

export function parseSettings(data: unknown): PluginSettings {
	return Object.assign({}, DEFAULT_SETTINGS, data as Partial<PluginSettings>);
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
					.setPlaceholder("claude")
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
					.setPlaceholder("e.g. sonnet, opus, haiku")
					.setValue(this.plugin.settings.modelOverride)
					.onChange(async (value) => {
						this.plugin.settings.modelOverride = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
