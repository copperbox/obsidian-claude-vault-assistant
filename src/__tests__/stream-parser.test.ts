import { describe, it, expect, vi } from "vitest";
import { parseStreamLine, StreamLineBuffer } from "../stream-parser";

describe("parseStreamLine", () => {
	it("returns null for empty string", () => {
		expect(parseStreamLine("")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		expect(parseStreamLine("not json")).toBeNull();
	});

	it("returns null for unknown event type", () => {
		expect(parseStreamLine('{"type":"unknown"}')).toBeNull();
	});

	it("parses assistant text content", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				content: [{ type: "text", text: "Hello world" }],
			},
		});
		expect(parseStreamLine(line)).toEqual({
			type: "text",
			text: "Hello world",
		});
	});

	it("extracts last content block from assistant message", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "first" },
					{ type: "text", text: "second" },
				],
			},
		});
		expect(parseStreamLine(line)).toEqual({
			type: "text",
			text: "second",
		});
	});

	it("parses tool_use content block with input", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", name: "Read", input: { path: "foo.md" } }],
			},
		});
		expect(parseStreamLine(line)).toEqual({
			type: "tool_use",
			id: undefined,
			name: "Read",
			filePath: undefined,
			input: { path: "foo.md" },
		});
	});

	it("parses tool_use id when present", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", id: "toolu_abc", name: "Read", input: { path: "foo.md" } }],
			},
		});
		expect(parseStreamLine(line)).toMatchObject({
			type: "tool_use",
			id: "toolu_abc",
			name: "Read",
		});
	});

	it("extracts file_path from Write tool_use", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", name: "Write", input: { file_path: "notes/test.md", content: "hello" } }],
			},
		});
		const result = parseStreamLine(line);
		expect(result).toMatchObject({
			type: "tool_use",
			name: "Write",
			filePath: "notes/test.md",
		});
		expect((result as { input?: Record<string, unknown> }).input).toEqual({
			file_path: "notes/test.md",
			content: "hello",
		});
	});

	it("extracts file_path from Edit tool_use", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/main.ts", old_string: "a", new_string: "b" } }],
			},
		});
		const result = parseStreamLine(line);
		expect(result).toMatchObject({
			type: "tool_use",
			name: "Edit",
			filePath: "src/main.ts",
		});
	});

	it("returns undefined filePath and input when tool_use has no input", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", name: "Grep" }],
			},
		});
		expect(parseStreamLine(line)).toEqual({
			type: "tool_use",
			id: undefined,
			name: "Grep",
			filePath: undefined,
			input: undefined,
		});
	});

	it("parses tool_result success from user event with string content", () => {
		const line = JSON.stringify({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_abc",
						content: "file contents",
					},
				],
			},
		});
		expect(parseStreamLine(line)).toEqual({
			type: "tool_result",
			toolUseId: "toolu_abc",
			isError: false,
			content: "file contents",
		});
	});

	it("parses tool_result error from user event", () => {
		const line = JSON.stringify({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_xyz",
						is_error: true,
						content: "File not found",
					},
				],
			},
		});
		expect(parseStreamLine(line)).toEqual({
			type: "tool_result",
			toolUseId: "toolu_xyz",
			isError: true,
			content: "File not found",
		});
	});

	it("parses tool_result with array content blocks", () => {
		const line = JSON.stringify({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_arr",
						content: [
							{ type: "text", text: "line1" },
							{ type: "text", text: "line2" },
						],
					},
				],
			},
		});
		expect(parseStreamLine(line)).toEqual({
			type: "tool_result",
			toolUseId: "toolu_arr",
			isError: false,
			content: "line1\nline2",
		});
	});

	it("returns null for user event without tool_result block", () => {
		const line = JSON.stringify({
			type: "user",
			message: {
				content: [{ type: "text", text: "hi" }],
			},
		});
		expect(parseStreamLine(line)).toBeNull();
	});

	it("returns null for user event with no content", () => {
		expect(parseStreamLine('{"type":"user","message":{"content":[]}}')).toBeNull();
	});

	it("returns null for assistant with empty content", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: { content: [] },
		});
		expect(parseStreamLine(line)).toBeNull();
	});

	it("returns null for assistant with no message", () => {
		expect(parseStreamLine('{"type":"assistant"}')).toBeNull();
	});

	it("returns null for text block with empty text", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: { content: [{ type: "text", text: "" }] },
		});
		expect(parseStreamLine(line)).toBeNull();
	});

	it("parses result event with text", () => {
		const line = JSON.stringify({
			type: "result",
			result: "Done!",
			cost_usd: 0.0123,
			duration_ms: 4500,
		});
		expect(parseStreamLine(line)).toEqual({
			type: "result",
			text: "Done!",
			costUsd: 0.0123,
			durationMs: 4500,
			stopReason: undefined,
		});
	});

	it("parses result event with total_cost_usd and usage tokens", () => {
		const line = JSON.stringify({
			type: "result",
			result: "Done!",
			total_cost_usd: 0.0234,
			duration_ms: 4500,
			usage: {
				input_tokens: 10,
				output_tokens: 20,
				cache_creation_input_tokens: 5,
				cache_read_input_tokens: 100,
			},
		});
		expect(parseStreamLine(line)).toEqual({
			type: "result",
			text: "Done!",
			costUsd: 0.0234,
			durationMs: 4500,
			stopReason: undefined,
			tokens: 135,
		});
	});

	it("parses result event without cost/duration", () => {
		const line = JSON.stringify({
			type: "result",
			result: "Finished",
		});
		expect(parseStreamLine(line)).toEqual({
			type: "result",
			text: "Finished",
			costUsd: undefined,
			durationMs: undefined,
			stopReason: undefined,
		});
	});

	it("parses result event with max_turns stop reason", () => {
		const line = JSON.stringify({
			type: "result",
			result: "Stopped",
			cost_usd: 0.05,
			duration_ms: 10000,
			stop_reason: "max_turns",
		});
		expect(parseStreamLine(line)).toEqual({
			type: "result",
			text: "Stopped",
			costUsd: 0.05,
			durationMs: 10000,
			stopReason: "max_turns",
		});
	});

	it("parses result event with budget_exceeded stop reason", () => {
		const line = JSON.stringify({
			type: "result",
			result: "Stopped",
			stop_reason: "budget_exceeded",
		});
		expect(parseStreamLine(line)).toEqual({
			type: "result",
			text: "Stopped",
			costUsd: undefined,
			durationMs: undefined,
			stopReason: "budget_exceeded",
		});
	});

	it("returns null for result with non-string result", () => {
		const line = JSON.stringify({ type: "result", result: 42 });
		expect(parseStreamLine(line)).toBeNull();
	});
});

describe("StreamLineBuffer", () => {
	it("calls handler for each complete line", () => {
		const handler = vi.fn();
		const buffer = new StreamLineBuffer(handler);

		buffer.push('{"type":"a"}\n{"type":"b"}\n');

		expect(handler).toHaveBeenCalledTimes(2);
		expect(handler).toHaveBeenCalledWith('{"type":"a"}');
		expect(handler).toHaveBeenCalledWith('{"type":"b"}');
	});

	it("buffers incomplete lines", () => {
		const handler = vi.fn();
		const buffer = new StreamLineBuffer(handler);

		buffer.push('{"type":');
		expect(handler).not.toHaveBeenCalled();

		buffer.push('"a"}\n');
		expect(handler).toHaveBeenCalledWith('{"type":"a"}');
	});

	it("handles multiple chunks forming one line", () => {
		const handler = vi.fn();
		const buffer = new StreamLineBuffer(handler);

		buffer.push('{"ty');
		buffer.push('pe":"');
		buffer.push('a"}\n');

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith('{"type":"a"}');
	});

	it("skips empty lines", () => {
		const handler = vi.fn();
		const buffer = new StreamLineBuffer(handler);

		buffer.push('\n\n{"type":"a"}\n\n');

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("flush sends remaining buffer", () => {
		const handler = vi.fn();
		const buffer = new StreamLineBuffer(handler);

		buffer.push('{"type":"a"}');
		expect(handler).not.toHaveBeenCalled();

		buffer.flush();
		expect(handler).toHaveBeenCalledWith('{"type":"a"}');
	});

	it("flush does nothing when buffer is empty", () => {
		const handler = vi.fn();
		const buffer = new StreamLineBuffer(handler);

		buffer.flush();
		expect(handler).not.toHaveBeenCalled();
	});
});
