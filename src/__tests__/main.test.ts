import { describe, it, expect, vi, beforeEach } from "vitest";
import ClaudeVaultAssistant from "../main";
import { VIEW_TYPE_CLAUDE_HISTORY } from "../history-view";
import { VIEW_TYPE_CLAUDE_CHAT } from "../chat-view";

interface MockCommand {
	id: string;
	name: string;
	callback?: () => void;
	checkCallback?: (checking: boolean) => boolean;
}

describe("ClaudeVaultAssistant", () => {
	it("should be importable", async () => {
		const mod = await import("../main");
		expect(mod.default).toBeDefined();
	});
});

describe("ClaudeVaultAssistant command registration", () => {
	let plugin: ClaudeVaultAssistant;
	let registeredCommands: MockCommand[];
	let registeredViewTypes: string[];
	let viewFactories: Map<string, (leaf: unknown) => unknown>;
	let ribbonIcons: { icon: string; title: string; callback: () => void }[];

	beforeEach(async () => {
		registeredCommands = [];
		registeredViewTypes = [];
		viewFactories = new Map();
		ribbonIcons = [];

		plugin = new ClaudeVaultAssistant({} as never, {} as never);
		plugin.addCommand = vi.fn((cmd: MockCommand) => {
			registeredCommands.push(cmd);
			return cmd as never;
		}) as never;
		plugin.addSettingTab = vi.fn();
		plugin.registerView = vi.fn((type: string, factory: (leaf: unknown) => unknown) => {
			registeredViewTypes.push(type);
			viewFactories.set(type, factory);
		}) as never;
		plugin.addRibbonIcon = vi.fn((icon: string, title: string, callback: () => void) => {
			ribbonIcons.push({ icon, title, callback });
			return { addClass: vi.fn(), removeClass: vi.fn() } as never;
		}) as never;
		plugin.loadData = vi.fn(async () => ({}));

		await plugin.onload();
	});

	it("registers the history and chat view types", () => {
		expect(registeredViewTypes).toContain(VIEW_TYPE_CLAUDE_HISTORY);
		expect(registeredViewTypes).toContain(VIEW_TYPE_CLAUDE_CHAT);
	});

	it("wires history callbacks at view construction, not only on activate", () => {
		// A pane restored from a saved workspace layout is built by the factory
		// alone; it must still receive entries and the resume action.
		const factory = viewFactories.get(VIEW_TYPE_CLAUDE_HISTORY)!;
		const view = factory({}) as unknown as {
			onResume: unknown;
			onClearHistory: unknown;
		};
		expect(view.onResume).toBeTruthy();
		expect(view.onClearHistory).toBeTruthy();
	});

	it("registers the run-prompt and chat ribbon icons", () => {
		const run = ribbonIcons.find((r) => r.title === "Run Claude prompt");
		expect(run).toBeDefined();
		expect(run!.icon).toBe("bot");
		expect(typeof run!.callback).toBe("function");

		const chat = ribbonIcons.find((r) => r.title === "Open Claude chat");
		expect(chat).toBeDefined();
		expect(typeof chat!.callback).toBe("function");
	});

	it("registers 4 commands", () => {
		expect(registeredCommands).toHaveLength(4);
	});

	it("registers Open Claude chat command", () => {
		const cmd = registeredCommands.find((c) => c.id === "open-chat");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Open Claude chat");
		expect(cmd!.callback).toBeDefined();
	});

	it("registers Run Claude Prompt (Vault) command", () => {
		const cmd = registeredCommands.find((c) => c.id === "run-vault-prompt");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Run Claude prompt (vault)");
		expect(cmd!.callback).toBeDefined();
	});

	it("registers Run Claude Prompt (Active Note) command with check", () => {
		const cmd = registeredCommands.find((c) => c.id === "run-note-prompt");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Run Claude prompt (active note)");
		expect(cmd!.checkCallback).toBeDefined();
	});

	it("keeps the open-output command id for the history view", () => {
		const cmd = registeredCommands.find((c) => c.id === "open-output");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Open Claude history");
		expect(cmd!.callback).toBeDefined();
	});

	it("no longer registers the ad-hoc prompt or stop commands", () => {
		expect(registeredCommands.find((c) => c.id === "run-adhoc-prompt")).toBeUndefined();
		expect(registeredCommands.find((c) => c.id === "stop-claude")).toBeUndefined();
	});

	it("note command returns false when no active file", () => {
		plugin.app = { workspace: { getActiveFile: () => null } } as never;
		const cmd = registeredCommands.find((c) => c.id === "run-note-prompt");
		expect(cmd!.checkCallback!(true)).toBe(false);
	});

	it("note command returns true when active file exists", () => {
		plugin.app = {
			workspace: { getActiveFile: () => ({ path: "test.md" }) },
		} as never;
		const cmd = registeredCommands.find((c) => c.id === "run-note-prompt");
		expect(cmd!.checkCallback!(true)).toBe(true);
	});
});
