import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	buildPrompt,
	buildArgs,
	buildSpawnCommand,
	shellEscape,
	ClaudeRunner,
	ClaudeRunnerError,
	type RunOptions,
} from "../claude-runner";
import { DEFAULT_SETTINGS } from "../settings";
import { EventEmitter } from "events";

function makeOptions(overrides?: Partial<RunOptions>): RunOptions {
	return {
		vaultPath: "/test/vault",
		promptContent: "Organize my notes",
		settings: { ...DEFAULT_SETTINGS },
		scope: "vault",
		...overrides,
	};
}

describe("buildPrompt", () => {
	it("returns prompt content for vault scope", () => {
		const result = buildPrompt(makeOptions());
		expect(result).toBe("Organize my notes");
	});

	it("prepends note constraint for note scope", () => {
		const result = buildPrompt(
			makeOptions({
				scope: "note",
				activeNotePath: "folder/my-note.md",
			})
		);
		expect(result).toBe(
			"Only make edits to this note: folder/my-note.md\nOrganize my notes"
		);
	});

	it("throws when note scope has no active note path", () => {
		expect(() =>
			buildPrompt(makeOptions({ scope: "note" }))
		).toThrow(ClaudeRunnerError);
		expect(() =>
			buildPrompt(makeOptions({ scope: "note" }))
		).toThrow("Note scope requires an active note path");
	});
});

describe("buildArgs", () => {
	it("includes base flags", () => {
		const args = buildArgs(makeOptions());
		expect(args).toContain("-p");
		expect(args).toContain("--output-format");
		expect(args).toContain("stream-json");
		expect(args).toContain("--verbose");
		expect(args).toContain("--no-session-persistence");
	});

	it("includes allowed tools", () => {
		const args = buildArgs(makeOptions());
		const toolsIdx = args.indexOf("--allowedTools");
		expect(toolsIdx).toBeGreaterThan(-1);
		expect(args.slice(toolsIdx + 1, toolsIdx + 6)).toEqual([
			"Read",
			"Grep",
			"Glob",
			"Write",
			"Edit",
		]);
	});

	it("omits --allowedTools when list is empty", () => {
		const opts = makeOptions({
			settings: { ...DEFAULT_SETTINGS, allowedTools: [] },
		});
		const args = buildArgs(opts);
		expect(args).not.toContain("--allowedTools");
	});

	it("includes max-turns from settings", () => {
		const args = buildArgs(makeOptions());
		const idx = args.indexOf("--max-turns");
		expect(idx).toBeGreaterThan(-1);
		expect(args[idx + 1]).toBe("50");
	});

	it("includes max-budget-usd when set", () => {
		const opts = makeOptions({
			settings: { ...DEFAULT_SETTINGS, maxBudget: 2.5 },
		});
		const args = buildArgs(opts);
		const idx = args.indexOf("--max-budget-usd");
		expect(idx).toBeGreaterThan(-1);
		expect(args[idx + 1]).toBe("2.5");
	});

	it("omits max-budget-usd when null", () => {
		const args = buildArgs(makeOptions());
		expect(args).not.toContain("--max-budget-usd");
	});

	it("includes model override when set", () => {
		const opts = makeOptions({
			settings: { ...DEFAULT_SETTINGS, modelOverride: "sonnet" },
		});
		const args = buildArgs(opts);
		const idx = args.indexOf("--model");
		expect(idx).toBeGreaterThan(-1);
		expect(args[idx + 1]).toBe("sonnet");
	});

	it("omits model flag when override is empty", () => {
		const args = buildArgs(makeOptions());
		expect(args).not.toContain("--model");
	});

	it("omits max-turns when set to 0", () => {
		const opts = makeOptions({
			settings: { ...DEFAULT_SETTINGS, maxTurns: 0 },
		});
		const args = buildArgs(opts);
		expect(args).not.toContain("--max-turns");
	});

	it("omits max-budget-usd when set to 0", () => {
		const opts = makeOptions({
			settings: { ...DEFAULT_SETTINGS, maxBudget: 0 },
		});
		const args = buildArgs(opts);
		expect(args).not.toContain("--max-budget-usd");
	});

	it("includes both max-turns and max-budget-usd when both configured", () => {
		const opts = makeOptions({
			settings: { ...DEFAULT_SETTINGS, maxTurns: 10, maxBudget: 1.5 },
		});
		const args = buildArgs(opts);
		const turnsIdx = args.indexOf("--max-turns");
		const budgetIdx = args.indexOf("--max-budget-usd");
		expect(turnsIdx).toBeGreaterThan(-1);
		expect(args[turnsIdx + 1]).toBe("10");
		expect(budgetIdx).toBeGreaterThan(-1);
		expect(args[budgetIdx + 1]).toBe("1.5");
	});

	it("always includes plugin system prompt with wiki link instructions", () => {
		const args = buildArgs(makeOptions());
		const idx = args.indexOf("--append-system-prompt");
		expect(idx).toBeGreaterThan(-1);
		expect(args[idx + 1]).toContain("[[wiki links]]");
	});

	it("appends user system prompt after plugin system prompt", () => {
		const opts = makeOptions({ systemPrompt: "You are helpful." });
		const args = buildArgs(opts);
		const indices = args.reduce<number[]>((acc, val, i) => {
			if (val === "--append-system-prompt") acc.push(i);
			return acc;
		}, []);
		expect(indices.length).toBe(2);
		// Plugin prompt first, user prompt second
		expect(args[indices[0]! + 1]).toContain("[[wiki links]]");
		expect(args[indices[1]! + 1]).toBe("You are helpful.");
	});
});

describe("shellEscape", () => {
	it("wraps a simple string in single quotes", () => {
		expect(shellEscape("hello")).toBe("'hello'");
	});

	it("escapes embedded single quotes", () => {
		expect(shellEscape("it's")).toBe("'it'\\''s'");
	});

	it("handles empty string", () => {
		expect(shellEscape("")).toBe("''");
	});

	it("escapes shell metacharacters safely", () => {
		const dangerous = '$(rm -rf /) && echo "pwned"';
		const escaped = shellEscape(dangerous);
		expect(escaped).toBe("'$(rm -rf /) && echo \"pwned\"'");
	});

	it("escapes multiple single quotes", () => {
		expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
	});
});

describe("buildSpawnCommand", () => {
	const originalPlatform = process.platform;
	const originalShell = process.env.SHELL;

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform });
		if (originalShell === undefined) {
			delete process.env.SHELL;
		} else {
			process.env.SHELL = originalShell;
		}
	});

	it("returns command and args directly on win32", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const result = buildSpawnCommand("claude", ["-p", "hello"]);
		expect(result.command).toBe("claude");
		expect(result.spawnArgs).toEqual(["-p", "hello"]);
	});

	it("wraps in login shell on darwin", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		process.env.SHELL = "/bin/zsh";
		const result = buildSpawnCommand("claude", ["-p", "hello"]);
		expect(result.command).toBe("/bin/zsh");
		expect(result.spawnArgs[0]).toBe("-l");
		expect(result.spawnArgs[1]).toBe("-c");
		expect(result.spawnArgs[2]).toContain("'claude'");
		expect(result.spawnArgs[2]).toContain("'hello'");
	});

	it("wraps in login shell on linux", () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		process.env.SHELL = "/bin/bash";
		const result = buildSpawnCommand("claude", ["-p", "test"]);
		expect(result.command).toBe("/bin/bash");
		expect(result.spawnArgs).toEqual([
			"-l",
			"-c",
			"'claude' '-p' 'test'",
		]);
	});

	it("falls back to /bin/bash when SHELL is unset", () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		delete process.env.SHELL;
		const result = buildSpawnCommand("claude", []);
		expect(result.command).toBe("/bin/bash");
	});

	it("escapes args containing single quotes", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		process.env.SHELL = "/bin/zsh";
		const result = buildSpawnCommand("claude", ["-p", "it's a test"]);
		expect(result.spawnArgs[2]).toContain("'it'\\''s a test'");
	});
});

vi.mock("child_process", () => {
	return {
		spawn: vi.fn(() => {
			const fakeChild = new EventEmitter() as EventEmitter & {
				kill: ReturnType<typeof vi.fn>;
				stdout: EventEmitter;
				stderr: EventEmitter;
			};
			fakeChild.kill = vi.fn();
			fakeChild.stdout = new EventEmitter();
			fakeChild.stderr = new EventEmitter();
			return fakeChild;
		}),
	};
});

describe("ClaudeRunner", () => {
	let runner: ClaudeRunner;

	beforeEach(() => {
		runner = new ClaudeRunner();
		vi.clearAllMocks();
	});

	it("starts with no active process", () => {
		expect(runner.isRunning).toBe(false);
	});

	it("spawns claude with correct args and cwd", async () => {
		const { spawn } = await import("child_process");
		const opts = makeOptions();
		runner.run(opts);

		expect(spawn).toHaveBeenCalledWith(
			"claude",
			expect.arrayContaining(["-p", "--output-format", "stream-json"]),
			expect.objectContaining({ cwd: "/test/vault" })
		);
	});

	it("rejects concurrent runs", () => {
		runner.run(makeOptions());
		expect(runner.isRunning).toBe(true);

		expect(() => runner.run(makeOptions())).toThrow(ClaudeRunnerError);
		expect(() => runner.run(makeOptions())).toThrow("already active");
	});

	it("clears active process on close event", () => {
		const child = runner.run(makeOptions());
		expect(runner.isRunning).toBe(true);

		child.emit("close");
		expect(runner.isRunning).toBe(false);
	});

	it("clears active process after stop", () => {
		const child = runner.run(makeOptions());
		expect(runner.isRunning).toBe(true);

		runner.stop();
		expect(runner.isRunning).toBe(false);
		expect((child as unknown as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalled();
	});

	it("stop is safe to call when not running", () => {
		expect(() => runner.stop()).not.toThrow();
	});

	it("emits runner-error on ENOENT", () => {
		const child = runner.run(makeOptions());
		const errorHandler = vi.fn();
		child.on("runner-error", errorHandler);

		const err = new Error("spawn ENOENT") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		child.emit("error", err);

		expect(errorHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("Claude CLI not found"),
			})
		);
		expect(runner.isRunning).toBe(false);
	});
});
