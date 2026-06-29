import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	PromptRunner,
	buildPromptText,
	type PromptRunCallbacks,
	type PromptRunOptions,
} from "../prompt-runner";
import { ChatSession } from "../chat-session";
import type { PermissionDecision } from "../permission-types";
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

function makeCallbacks(): PromptRunCallbacks & {
	[k: string]: ReturnType<typeof vi.fn>;
} {
	return {
		onSystemInit: vi.fn(),
		onAssistantText: vi.fn(),
		onToolUse: vi.fn(),
		onToolResult: vi.fn(),
		onResult: vi.fn(),
		onError: vi.fn(),
		onComplete: vi.fn(),
	} as never;
}

function baseOptions(over: Partial<PromptRunOptions> = {}): PromptRunOptions {
	return {
		vaultPath: "/vault",
		settings: { ...DEFAULT_SETTINGS },
		scope: "vault",
		promptBody: "do it",
		...over,
	};
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A PromptRunner wired to a fake SDK query, capturing the options passed in. */
function setup(decision: PermissionDecision = "once") {
	const fake = makeFakeQuery();
	const callbacks = makeCallbacks();
	const requestPermission = vi.fn(
		async (): Promise<PermissionDecision> => decision
	);
	let captured: Record<string, unknown> = {};
	const runner = new PromptRunner({
		createSession: (cfg) =>
			new ChatSession({
				...cfg,
				queryFn: ((p: { options?: Record<string, unknown> }) => {
					captured = p.options ?? {};
					return fake.query as never;
				}) as never,
				resolveEnv: () => ({ PATH: "/bin" }),
			}),
	});
	return {
		fake,
		callbacks,
		runner,
		requestPermission,
		getCaptured: () => captured,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("buildPromptText", () => {
	it("returns the body unchanged for vault scope", () => {
		expect(buildPromptText("vault", "do the thing")).toBe("do the thing");
	});

	it("prepends the note restriction for note scope", () => {
		expect(buildPromptText("note", "summarize", "Notes/a.md")).toBe(
			"Only make edits to this note: Notes/a.md\nsummarize"
		);
	});

	it("throws for note scope without a path", () => {
		expect(() => buildPromptText("note", "x")).toThrow();
	});
});

describe("PromptRunner", () => {
	it("reports success with cost, tokens and duration from the result", async () => {
		const { fake, callbacks, runner } = setup();
		await runner.run(baseOptions(), callbacks);

		fake.emit({
			type: "result",
			subtype: "success",
			result: "done",
			total_cost_usd: 0.02,
			duration_ms: 500,
			usage: { input_tokens: 5, output_tokens: 7 },
			is_error: false,
		});
		await flush();

		expect(callbacks.onComplete).toHaveBeenCalledOnce();
		expect(callbacks.onComplete).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "success",
				costUsd: 0.02,
				durationMs: 500,
				tokens: 12,
			})
		);
		expect(runner.isRunning).toBe(false);
	});

	it("forwards assistant text and tool calls", async () => {
		const { fake, callbacks, runner } = setup();
		await runner.run(baseOptions(), callbacks);

		fake.emit({
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "working" },
					{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "a.md" } },
				],
			},
		});
		await flush();

		expect(callbacks.onAssistantText).toHaveBeenCalledWith("working");
		expect(callbacks.onToolUse).toHaveBeenCalledWith(
			expect.objectContaining({ id: "t1", name: "Edit", filePath: "a.md" })
		);
	});

	it("maps error_max_turns to a max-turns limit", async () => {
		const { fake, callbacks, runner } = setup();
		await runner.run(baseOptions(), callbacks);

		fake.emit({ type: "result", subtype: "error_max_turns", is_error: true });
		await flush();

		expect(callbacks.onComplete).toHaveBeenCalledWith(
			expect.objectContaining({ status: "limit", limit: "max_turns" })
		);
	});

	it("maps error_max_budget_usd to a budget limit", async () => {
		const { fake, callbacks, runner } = setup();
		await runner.run(baseOptions(), callbacks);

		fake.emit({ type: "result", subtype: "error_max_budget_usd", is_error: true });
		await flush();

		expect(callbacks.onComplete).toHaveBeenCalledWith(
			expect.objectContaining({ status: "limit", limit: "budget" })
		);
	});

	it("maps a non-limit error subtype to an error outcome", async () => {
		const { fake, callbacks, runner } = setup();
		await runner.run(baseOptions(), callbacks);

		fake.emit({
			type: "result",
			subtype: "error_during_execution",
			is_error: true,
		});
		await flush();

		expect(callbacks.onComplete).toHaveBeenCalledWith(
			expect.objectContaining({ status: "error" })
		);
	});

	it("maps a session start failure to an error outcome", async () => {
		const callbacks = makeCallbacks();
		const runner = new PromptRunner({
			createSession: (cfg) =>
				new ChatSession({
					...cfg,
					queryFn: (() => {
						throw new Error("Claude CLI not found");
					}) as never,
					resolveEnv: () => ({ PATH: "/bin" }),
				}),
		});

		await runner.run(baseOptions(), callbacks);
		await flush();

		expect(callbacks.onError).toHaveBeenCalledWith("Claude CLI not found");
		expect(callbacks.onComplete).toHaveBeenCalledWith(
			expect.objectContaining({ status: "error" })
		);
	});

	it("stop() interrupts and reports a stopped outcome once", async () => {
		const { fake, callbacks, runner } = setup();
		await runner.run(baseOptions(), callbacks);

		runner.stop();
		await flush();

		expect(fake.interruptSpy).toHaveBeenCalledOnce();
		expect(callbacks.onComplete).toHaveBeenCalledOnce();
		expect(callbacks.onComplete).toHaveBeenCalledWith(
			expect.objectContaining({ status: "stopped" })
		);
	});

	it("fires onComplete once when stop races with a result", async () => {
		const { fake, callbacks, runner } = setup();
		await runner.run(baseOptions(), callbacks);

		runner.stop();
		fake.emit({ type: "result", subtype: "success", is_error: false });
		await flush();

		expect(callbacks.onComplete).toHaveBeenCalledOnce();
	});

	it("ignores a second run while one is active", async () => {
		const { callbacks, runner } = setup();
		await runner.run(baseOptions(), callbacks);

		const cb2 = makeCallbacks();
		await runner.run(baseOptions(), cb2);
		await flush();

		expect(cb2.onComplete).not.toHaveBeenCalled();
	});

	it("prompts for permission via the provided callback and maps the decision", async () => {
		const { runner, callbacks, requestPermission, getCaptured } = setup("once");
		await runner.run(baseOptions({ requestPermission }), callbacks);

		const canUseTool = getCaptured().canUseTool as unknown as (
			n: string,
			i: Record<string, unknown>,
			o: Record<string, unknown>
		) => Promise<{ behavior: string }>;
		const r = await canUseTool("Bash", { command: "ls" }, { toolUseID: "x" });

		expect(r.behavior).toBe("allow");
		expect(requestPermission).toHaveBeenCalledOnce();
	});

	it("denies non-whitelisted tools by default (no requestPermission)", async () => {
		const { runner, callbacks, getCaptured } = setup();
		await runner.run(baseOptions(), callbacks);

		const canUseTool = getCaptured().canUseTool as unknown as (
			n: string,
			i: Record<string, unknown>,
			o: Record<string, unknown>
		) => Promise<{ behavior: string }>;
		const r = await canUseTool("Bash", { command: "rm" }, { toolUseID: "x" });

		expect(r.behavior).toBe("deny");
	});

	it("passes the extra system prompt and disables session persistence", async () => {
		const { runner, callbacks, getCaptured } = setup();
		await runner.run(
			baseOptions({ extraSystemPrompt: "House rules." }),
			callbacks
		);

		const opts = getCaptured();
		const sp = opts.systemPrompt as { append?: string };
		expect(sp.append).toContain("[[wiki links]]");
		expect(sp.append).toContain("House rules.");
		const extraArgs = opts.extraArgs as Record<string, unknown>;
		expect(extraArgs["no-session-persistence"]).toBeNull();
	});
});
