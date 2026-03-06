export class Plugin {
	app = {};
	manifest = {};
	loadData = async () => ({});
	saveData = async () => {};
	addCommand = () => {};
	addSettingTab = () => {};
	addRibbonIcon = () => {};
	registerView = () => {};
	registerEvent = () => {};
	registerDomEvent = () => {};
	registerInterval = () => 0;
	addStatusBarItem = () => ({ setText: () => {} });
}

export class PluginSettingTab {
	app: unknown;
	containerEl = {
		empty: () => {},
		createEl: () => ({}),
	};
	constructor(app: unknown, _plugin: unknown) {
		this.app = app;
	}
	display() {}
	hide() {}
}

export class Setting {
	constructor(_containerEl: unknown) {}
	setName = () => this;
	setDesc = () => this;
	addText = () => this;
	addToggle = () => this;
	addDropdown = () => this;
	addTextArea = () => this;
}

export class SuggestModal {
	app: unknown;
	constructor(app: unknown) {
		this.app = app;
	}
	open() {}
	close() {}
	getSuggestions(): unknown[] { return []; }
	renderSuggestion() {}
	onChooseSuggestion() {}
}

export class Modal {
	app: unknown;
	contentEl = { empty: () => {}, setText: () => {}, createEl: () => ({}) };
	constructor(app: unknown) {
		this.app = app;
	}
	open() {}
	close() {}
	onOpen() {}
	onClose() {}
}

export class ItemView {
	app: unknown;
	containerEl = {
		empty: () => {},
		children: [],
	};
	contentEl = {
		empty: () => {},
		createEl: () => ({}),
		createDiv: () => ({ empty: () => {}, createEl: () => ({}), createDiv: () => ({}) }),
		innerHTML: "",
	};
	constructor() {}
	getViewType() { return ""; }
	getDisplayText() { return ""; }
	onOpen() { return Promise.resolve(); }
	onClose() { return Promise.resolve(); }
}

export class Notice {
	constructor(_message: string, _timeout?: number) {}
}

export class MarkdownRenderer {
	static render = async () => {};
}

export const normalizePath = (path: string) => path;
