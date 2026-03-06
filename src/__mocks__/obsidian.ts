export class Plugin {
	app: Record<string, unknown> = {};
	manifest = {};
	loadData = async () => ({});
	saveData = async () => {};
	addCommand = (_cmd: unknown) => {};
	addSettingTab = () => {};
	addRibbonIcon = (_icon: string, _title: string, _callback: () => void) => createMockEl();
	registerView = (_type: string, _factory: (leaf: unknown) => unknown) => {};
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
	setPlaceholder(_text: string) {}
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

function createMockEl(): Record<string, unknown> {
	const el: Record<string, unknown> = {
		empty: () => {},
		createEl: (_tag: string, _opts?: Record<string, unknown>) => createMockEl(),
		createDiv: (_opts?: Record<string, unknown>) => createMockEl(),
		addClass: (_cls: string) => {},
		removeClass: (_cls: string) => {},
		setText: (_text: string) => {},
		show: () => {},
		hide: () => {},
		addEventListener: (_event: string, _handler: () => void) => {},
		closest: (_selector: string) => null,
		getAttr: (_name: string) => null,
		innerHTML: "",
		scrollTop: 0,
		scrollHeight: 0,
		textContent: "",
		className: "",
	};
	return el;
}

export class WorkspaceLeaf {
	view: unknown = null;
	async setViewState(_state: unknown) {}
}

export class ItemView {
	app: unknown;
	leaf: unknown;
	containerEl = createMockEl();
	contentEl = createMockEl();
	constructor(leaf?: unknown) {
		this.leaf = leaf;
	}
	getViewType() { return ""; }
	getDisplayText() { return ""; }
	getIcon() { return ""; }
	onOpen() { return Promise.resolve(); }
	onClose() { return Promise.resolve(); }
}

export class Notice {
	constructor(_message: string, _timeout?: number) {}
}

export class MarkdownRenderer {
	static render = async () => {};
}

export class TFolder {
	path: string;
	constructor(path: string) {
		this.path = path;
	}
}

export class TFile {
	name: string;
	path: string;
	parent: TFolder | null;
	extension: string;
	constructor(name: string, path: string, parent: TFolder | null = null) {
		this.name = name;
		this.path = path;
		this.parent = parent;
		this.extension = name.split(".").pop() ?? "";
	}
}

export class Vault {
	private files: TFile[] = [];
	private contents: Map<string, string> = new Map();

	_addFile(name: string, parentPath: string, content = "") {
		const path = parentPath === "/" ? name : `${parentPath}/${name}`;
		const file = new TFile(name, path, new TFolder(parentPath));
		this.files.push(file);
		this.contents.set(path, content);
		return file;
	}

	getMarkdownFiles(): TFile[] {
		return this.files.filter((f) => f.extension === "md");
	}

	getFileByPath(path: string): TFile | null {
		return this.files.find((f) => f.path === path) ?? null;
	}

	async read(file: TFile): Promise<string> {
		const content = this.contents.get(file.path);
		if (content === undefined) {
			throw new Error(`File not found: ${file.path}`);
		}
		return content;
	}
}

export const normalizePath = (path: string) => path;
