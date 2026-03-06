import { Plugin } from "obsidian";

export default class ClaudeVaultAssistant extends Plugin {
	async onload() {
		console.log("Loading Claude Vault Assistant");
	}

	onunload() {
		console.log("Unloading Claude Vault Assistant");
	}
}
