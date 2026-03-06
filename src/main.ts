import { Plugin } from "obsidian";
import {
	ClaudeVaultSettingTab,
	DEFAULT_SETTINGS,
	parseSettings,
	type PluginSettings,
} from "./settings";

export default class ClaudeVaultAssistant extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ClaudeVaultSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = parseSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
