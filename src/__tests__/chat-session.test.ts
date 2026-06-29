import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	ChatSession,
	buildChatOptions,
	type ChatCallbacks,
	type ChatSessionConfig,
	type PermissionDecision,
} from "../chat-session";
import { DEFAULT_SETTINGS } from "../settings";

/** Controllable fake of the SDK Query (an async generator + interrupt()). */
function makeFakeQuery() {
	const pending: unknown[] = [];
	const waiting: ((r: IteratorResult<unknown>) => void)[] = [];
	let closed = false;
	const interruptSpy = vi.fn(async () => {});

	const emit = (msg: unknown) => {
		const w = waiting.shift();
		if (w) w({ value: msg, done: false });
		else pending.push(msg);
	};
	const close = () => {
		closed = true;
		let w = waiting.shift();
		while (w) {
			w({ value: undefined, done: true });
			w = waiting.shift();
		}
	};

	const query = {
		interrupt: interruptSpy,
		[Symbol.asyncIterator]() {
			return {
				next: (): Promise<IteratorResult<unknown>> => {
					const n = pending.shift();
					if (n !== undefined) return Promise.resolve({ value: n, done: false });
					if (closed) return Promise.resolve({ value: undefined, done: true });
					return new Promise((resolve) => waiting.push(resolve));
				},
			};
		},
	};

	return { query, emit, close, interruptSpy };
}

function makeCallbacks(): ChatCallbacks & {
	[k: string]: ReturnType<typeof vi.fn>;
} {
	return {
		onSystemInit: vi.fn(),
		onAssistantText: vi.fn(),
		onToolUse: vi.fn(),
		onToolResult: vi.fn(),
		onResult: vi.fn(),
		onError: vi.fn(),
		onTurnStart: vi.fn(),
		onTurnEnd: vi.fn(),
		onUsage: vi.fn(),
	} as never;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("buildChatOptions", () => {
	const env = { PATH: "/bin" };

	it("sets cwd, CLI path, default permission mode and the whitelist", () => {
		const opts = buildChatOptions({
			vaultPath: "/vault",
			settings: { ...DEFAULT_SETTINGS },
			env,
			canUseTool: async () => ({ behavior: "allow" }),
		});
		expect(opts.cwd).toBe("/vault");
		expect(opts.pathToClaudeCodeExecutable).toBe("claude");
		expect(opts.permissionMode).toBe("default");
		expect(opts.allowedTools).toEqual(["Read", "Grep", "Glob", "Write", "Edit"]);
		expect(opts.env).toBe(env);
	});

	it("appends the Obsidian wiki-link prompt to the claude_code preset", () => {
		const opts = buildChatOptions({
			vaultPath: "/vault",
			settings: { ...DEFAULT_SETTINGS },
			env,
			canUseTool: async () => ({ behavior: "allow" }),
		});
		expect(opts.systemPrompt).toMatchObject({
			type: "preset",
			preset: "claude_code",
		});
		const sp = opts.systemPrompt as { append?: string };
		expect(sp.append).toContain("[[wiki links]]");
	});

	it("includes maxTurns and model when configured, budget via extraArgs", () => {
		const opts = buildChatOptions({
			vaultPath: "/vault",
			settings: {
				...DEFAULT_SETTINGS,
				maxTurns: 12,
				modelOverride: "opus",
				maxBudget: 3.5,
			},
			env,
			canUseTool: async () => ({ behavior: "allow" }),
		});
		expect(opts.maxTurns).toBe(12);
		expect(opts.model).toBe("opus");
		expect(opts.extraArgs).toEqual({ "max-budget-usd": "3.5" });
	});

	it("omits maxTurns/model/budget when unset", () => {
		const opts = buildChatOptions({
			vaultPath: "/vault",
			settings: { ...DEFAULT_SETTINGS, maxTurns: 0, maxBudget: null },
			env,
			canUseTool: async () => ({ behavior: "allow" }),
		});
		expect(opts.maxTurns).toBeUndefined();
		expect(opts.model).toBeUndefined();
		expect(opts.extraArgs).toBeUndefined();
	});

	it("appends an extra system prompt after the wiki-link prompt", () => {
		const opts = buildChatOptions({
			vaultPath: "/vault",
			settings: { ...DEFAULT_SETTINGS },
			env,
			canUseTool: async () => ({ behavior: "allow" }),
			extraSystemPrompt: "Vault house rules.",
		});
		const sp = opts.systemPrompt as { append?: string };
		expect(sp.append).toContain("[[wiki links]]");
		expect(sp.append).toContain("Vault house rules.");
		// The extra prompt comes after the base prompt.
		expect(sp.append?.indexOf("[[wiki links]]") ?? -1).toBeLessThan(
			sp.append?.indexOf("Vault house rules.") ?? -1
		);
	});

	it("adds the no-session-persistence flag, composing with budget", () => {
		const opts = buildChatOptions({
			vaultPath: "/vault",
			settings: { ...DEFAULT_SETTINGS, maxBudget: 2 },
			env,
			canUseTool: async () => ({ behavior: "allow" }),
			disableSessionPersistence: true,
		});
		expect(opts.extraArgs).toEqual({
			"max-budget-usd": "2",
			"no-session-persistence": null,
		});
	});
});

describe("ChatSession", () => {
	let fake: ReturnType<typeof makeFakeQuery>;
	let callbacks: ReturnType<typeof makeCallbacks>;
	let capturedOptions: { canUseTool?: ChatSessionConfig["requestPermission"] } & Record<string, unknown>;
	let requestPermission: ReturnType<typeof vi.fn>;

	function makeSession(decision: PermissionDecision = "once") {
		fake = makeFakeQuery();
		callbacks = makeCallbacks();
		requestPermission = vi.fn(async () => decision);
		const queryFn = vi.fn((params: { options?: Record<string, unknown> }) => {
			capturedOptions = params.options ?? {};
			return fake.query as never;
		});
		return new ChatSession({
			vaultPath: "/vault",
			settings: { ...DEFAULT_SETTINGS },
			callbacks,
			requestPermission,
			queryFn: queryFn as never,
			resolveEnv: () => ({ PATH: "/bin" }),
		});
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("dispatches assistant text and tool calls from the stream", async () => {
		const session = makeSession();
		await session.start();

		fake.emit({
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "Hello there" },
					{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: "a.md" } },
				],
			},
		});
		await flush();

		expect(callbacks.onAssistantText).toHaveBeenCalledWith("Hello there");
		expect(callbacks.onToolUse).toHaveBeenCalledWith(
			expect.objectContaining({ id: "tu1", name: "Read", filePath: "a.md" })
		);
	});

	it("dispatches tool results from user messages", async () => {
		const session = makeSession();
		await session.start();

		fake.emit({
			type: "user",
			message: {
				content: [
					{ type: "tool_result", tool_use_id: "tu1", is_error: false, content: "ok" },
				],
			},
		});
		await flush();

		expect(callbacks.onToolResult).toHaveBeenCalledWith({
			toolUseId: "tu1",
			isError: false,
			content: "ok",
		});
	});

	it("marks a turn active on send and ends it on result", async () => {
		const session = makeSession();
		await session.start();

		session.send("hi");
		expect(callbacks.onTurnStart).toHaveBeenCalledOnce();
		expect(session.isTurnActive).toBe(true);

		fake.emit({
			type: "result",
			subtype: "success",
			result: "done",
			total_cost_usd: 0.01,
			duration_ms: 1234,
			is_error: false,
		});
		await flush();

		expect(callbacks.onResult).toHaveBeenCalledWith({
			text: "done",
			costUsd: 0.01,
			durationMs: 1234,
			tokens: undefined,
			isError: false,
			subtype: "success",
		});
		expect(callbacks.onTurnEnd).toHaveBeenCalledOnce();
		expect(session.isTurnActive).toBe(false);
	});

	it("sums usage tokens into the result", async () => {
		const session = makeSession();
		await session.start();
		session.send("hi");

		fake.emit({
			type: "result",
			subtype: "success",
			result: "done",
			total_cost_usd: 0.01,
			duration_ms: 1234,
			usage: {
				input_tokens: 10,
				output_tokens: 20,
				cache_read_input_tokens: 100,
			},
			is_error: false,
		});
		await flush();

		expect(callbacks.onResult).toHaveBeenCalledWith(
			expect.objectContaining({ tokens: 130 })
		);
	});

	it("emits a cumulative output-token count per assistant message", async () => {
		const session = makeSession();
		await session.start();
		session.send("hi");

		fake.emit({
			type: "assistant",
			message: {
				content: [{ type: "text", text: "a" }],
				usage: { output_tokens: 12 },
			},
		});
		await flush();
		expect(callbacks.onUsage).toHaveBeenLastCalledWith(12);

		fake.emit({
			type: "assistant",
			message: {
				content: [{ type: "text", text: "b" }],
				usage: { output_tokens: 8 },
			},
		});
		await flush();
		expect(callbacks.onUsage).toHaveBeenLastCalledWith(20);
	});

	it("skips the usage callback when a message has no output tokens", async () => {
		const session = makeSession();
		await session.start();
		session.send("hi");

		fake.emit({
			type: "assistant",
			message: { content: [{ type: "text", text: "a" }] },
		});
		await flush();
		expect(callbacks.onUsage).not.toHaveBeenCalled();
	});

	it("resets the running token count at the start of each turn", async () => {
		const session = makeSession();
		await session.start();

		session.send("first");
		fake.emit({
			type: "assistant",
			message: { content: [], usage: { output_tokens: 30 } },
		});
		await flush();
		expect(callbacks.onUsage).toHaveBeenLastCalledWith(30);

		fake.emit({
			type: "result",
			subtype: "success",
			result: "done",
			is_error: false,
		});
		await flush();

		session.send("second");
		fake.emit({
			type: "assistant",
			message: { content: [], usage: { output_tokens: 5 } },
		});
		await flush();
		expect(callbacks.onUsage).toHaveBeenLastCalledWith(5);
	});

	it("allows a tool once without caching when the user picks 'once'", async () => {
		const session = makeSession("once");
		await session.start();
		const canUseTool = capturedOptions.canUseTool as unknown as (
			n: string,
			i: Record<string, unknown>,
			o: Record<string, unknown>
		) => Promise<{ behavior: string }>;

		const r1 = await canUseTool("Bash", { command: "ls" }, { toolUseID: "x" });
		expect(r1.behavior).toBe("allow");
		await canUseTool("Bash", { command: "ls" }, { toolUseID: "y" });
		// 'once' does not cache: prompted both times.
		expect(requestPermission).toHaveBeenCalledTimes(2);
		expect(session.sessionAllowedTools).toEqual([]);
	});

	it("caches a tool for the session when the user picks 'session'", async () => {
		const session = makeSession("session");
		await session.start();
		const canUseTool = capturedOptions.canUseTool as unknown as (
			n: string,
			i: Record<string, unknown>,
			o: Record<string, unknown>
		) => Promise<{ behavior: string }>;

		await canUseTool("Bash", { command: "ls" }, { toolUseID: "x" });
		await canUseTool("Bash", { command: "pwd" }, { toolUseID: "y" });
		// Second call is auto-allowed without prompting again.
		expect(requestPermission).toHaveBeenCalledTimes(1);
		expect(session.sessionAllowedTools).toEqual(["Bash"]);
	});

	it("denies the tool when the user declines", async () => {
		const session = makeSession("deny");
		await session.start();
		const canUseTool = capturedOptions.canUseTool as unknown as (
			n: string,
			i: Record<string, unknown>,
			o: Record<string, unknown>
		) => Promise<{ behavior: string; message?: string }>;

		const r = await canUseTool("Bash", { command: "rm" }, { toolUseID: "x" });
		expect(r.behavior).toBe("deny");
		expect(r.message).toBeTruthy();
	});

	it("interrupt calls the SDK interrupt and ends the turn", async () => {
		const session = makeSession();
		await session.start();
		session.send("hi");

		await session.interrupt();
		expect(fake.interruptSpy).toHaveBeenCalledOnce();
		expect(session.isTurnActive).toBe(false);
	});

	it("dispose closes input and is idempotent", async () => {
		const session = makeSession();
		await session.start();
		await session.dispose();
		await session.dispose();
		// send after dispose is a no-op.
		session.send("late");
		expect(callbacks.onTurnStart).not.toHaveBeenCalled();
	});
});
