import { describe, it, expect, vi, beforeEach } from "vitest";
import ClaudeVaultAssistant from "../main";
import { VIEW_TYPE_CLAUDE_OUTPUT } from "../output-view";
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
	let ribbonIcons: { icon: string; title: string; callback: () => void }[];

	beforeEach(async () => {
		registeredCommands = [];
		registeredViewTypes = [];
		ribbonIcons = [];

		plugin = new ClaudeVaultAssistant({} as never, {} as never);
		plugin.addCommand = vi.fn((cmd: MockCommand) => {
			registeredCommands.push(cmd);
			return cmd as never;
		}) as never;
		plugin.addSettingTab = vi.fn();
		plugin.registerView = vi.fn((type: string) => {
			registeredViewTypes.push(type);
		}) as never;
		plugin.addRibbonIcon = vi.fn((icon: string, title: string, callback: () => void) => {
			ribbonIcons.push({ icon, title, callback });
			return { addClass: vi.fn(), removeClass: vi.fn() } as never;
		}) as never;
		plugin.loadData = vi.fn(async () => ({}));

		await plugin.onload();
	});

	it("registers the output and chat view types", () => {
		expect(registeredViewTypes).toContain(VIEW_TYPE_CLAUDE_OUTPUT);
		expect(registeredViewTypes).toContain(VIEW_TYPE_CLAUDE_CHAT);
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

	it("registers 6 commands", () => {
		expect(registeredCommands).toHaveLength(6);
	});

	it("registers Open Claude chat command", () => {
		const cmd = registeredCommands.find((c) => c.id === "open-chat");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Open Claude chat");
		expect(cmd!.callback).toBeDefined();
	});

	it("registers Run ad-hoc Claude prompt command", () => {
		const cmd = registeredCommands.find((c) => c.id === "run-adhoc-prompt");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Run ad-hoc Claude prompt");
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

	it("registers Stop Claude command with check", () => {
		const cmd = registeredCommands.find((c) => c.id === "stop-claude");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Stop Claude");
		expect(cmd!.checkCallback).toBeDefined();
	});

	it("registers Open Claude Output command", () => {
		const cmd = registeredCommands.find((c) => c.id === "open-output");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Open Claude output");
		expect(cmd!.callback).toBeDefined();
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

	it("stop command returns false when not running", () => {
		const cmd = registeredCommands.find((c) => c.id === "stop-claude");
		expect(cmd!.checkCallback!(true)).toBe(false);
	});
});
