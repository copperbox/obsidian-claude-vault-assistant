import { describe, it, expect, vi, beforeEach } from "vitest";
import ClaudeVaultAssistant from "../main";
import { VIEW_TYPE_CLAUDE_OUTPUT } from "../output-view";

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
	let registeredViewType: string | null;
	let ribbonIconArgs: { icon: string; title: string; callback: () => void } | null;

	beforeEach(async () => {
		registeredCommands = [];
		registeredViewType = null;
		ribbonIconArgs = null;

		plugin = new ClaudeVaultAssistant({} as never, {} as never);
		plugin.addCommand = vi.fn((cmd: MockCommand) => {
			registeredCommands.push(cmd);
			return cmd as never;
		}) as never;
		plugin.addSettingTab = vi.fn();
		plugin.registerView = vi.fn((type: string) => {
			registeredViewType = type;
		}) as never;
		plugin.addRibbonIcon = vi.fn((icon: string, title: string, callback: () => void) => {
			ribbonIconArgs = { icon, title, callback };
			return { addClass: vi.fn(), removeClass: vi.fn() } as never;
		}) as never;
		plugin.loadData = vi.fn(async () => ({}));

		await plugin.onload();
	});

	it("registers the output view type", () => {
		expect(registeredViewType).toBe(VIEW_TYPE_CLAUDE_OUTPUT);
	});

	it("registers a ribbon icon", () => {
		expect(ribbonIconArgs).not.toBeNull();
		expect(ribbonIconArgs!.icon).toBe("bot");
		expect(ribbonIconArgs!.title).toBe("Run Claude Prompt");
		expect(typeof ribbonIconArgs!.callback).toBe("function");
	});

	it("registers 4 commands", () => {
		expect(registeredCommands).toHaveLength(4);
	});

	it("registers Run Claude Prompt (Vault) command", () => {
		const cmd = registeredCommands.find((c) => c.id === "run-vault-prompt");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Run Claude Prompt (Vault)");
		expect(cmd!.callback).toBeDefined();
	});

	it("registers Run Claude Prompt (Active Note) command with check", () => {
		const cmd = registeredCommands.find((c) => c.id === "run-note-prompt");
		expect(cmd).toBeDefined();
		expect(cmd!.name).toBe("Run Claude Prompt (Active Note)");
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
		expect(cmd!.name).toBe("Open Claude Output");
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
