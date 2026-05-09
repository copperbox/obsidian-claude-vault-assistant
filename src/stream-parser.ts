export interface ParsedText {
	type: "text";
	text: string;
}

export interface ParsedToolUse {
	type: "tool_use";
	id?: string;
	name: string;
	filePath?: string;
	input?: Record<string, unknown>;
}

export interface ParsedToolResult {
	type: "tool_result";
	toolUseId: string;
	isError: boolean;
	content: string;
}

export interface ParsedResult {
	type: "result";
	text: string;
	costUsd?: number;
	durationMs?: number;
	stopReason?: string;
}

export type ParsedEvent = ParsedText | ParsedToolUse | ParsedToolResult | ParsedResult;

export function parseStreamLine(line: string): ParsedEvent | null {
	if (!line.trim()) return null;

	let data: Record<string, unknown>;
	try {
		data = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return null;
	}

	const type = data["type"];

	if (type === "assistant") {
		return parseAssistantEvent(data);
	}

	if (type === "user") {
		return parseUserEvent(data);
	}

	if (type === "result") {
		return parseResultEvent(data);
	}

	return null;
}

function parseAssistantEvent(data: Record<string, unknown>): ParsedEvent | null {
	const message = data["message"] as Record<string, unknown> | undefined;
	if (!message) return null;

	const content = message["content"] as unknown[] | undefined;
	if (!Array.isArray(content) || content.length === 0) return null;

	const lastBlock = content[content.length - 1] as Record<string, unknown>;
	if (!lastBlock) return null;

	if (lastBlock["type"] === "text") {
		const text = lastBlock["text"];
		if (typeof text === "string" && text.length > 0) {
			return { type: "text", text };
		}
	}

	if (lastBlock["type"] === "tool_use") {
		const name = lastBlock["name"];
		if (typeof name === "string") {
			const input = lastBlock["input"] as Record<string, unknown> | undefined;
			const filePath = input && typeof input["file_path"] === "string"
				? input["file_path"]
				: undefined;
			const id = typeof lastBlock["id"] === "string" ? lastBlock["id"] : undefined;
			return { type: "tool_use", id, name, filePath, input };
		}
	}

	return null;
}

function parseUserEvent(data: Record<string, unknown>): ParsedToolResult | null {
	const message = data["message"] as Record<string, unknown> | undefined;
	if (!message) return null;

	const content = message["content"] as unknown[] | undefined;
	if (!Array.isArray(content) || content.length === 0) return null;

	for (const block of content) {
		const b = block as Record<string, unknown>;
		if (b["type"] !== "tool_result") continue;
		const toolUseId = b["tool_use_id"];
		if (typeof toolUseId !== "string") continue;
		const isError = b["is_error"] === true;
		const rawContent = b["content"];
		const text = stringifyToolResultContent(rawContent);
		return { type: "tool_result", toolUseId, isError, content: text };
	}

	return null;
}

function stringifyToolResultContent(raw: unknown): string {
	if (typeof raw === "string") return raw;
	if (Array.isArray(raw)) {
		const parts: string[] = [];
		for (const item of raw) {
			const b = item as Record<string, unknown>;
			if (b && b["type"] === "text" && typeof b["text"] === "string") {
				parts.push(b["text"]);
			}
		}
		return parts.join("\n");
	}
	return "";
}

function parseResultEvent(data: Record<string, unknown>): ParsedResult | null {
	const result = data["result"];
	if (typeof result !== "string") return null;

	const costUsd = typeof data["cost_usd"] === "number" ? data["cost_usd"] : undefined;
	const durationMs = typeof data["duration_ms"] === "number" ? data["duration_ms"] : undefined;
	const stopReason = typeof data["stop_reason"] === "string" ? data["stop_reason"] : undefined;

	return { type: "result", text: result, costUsd, durationMs, stopReason };
}

export class StreamLineBuffer {
	private buffer = "";
	private handler: (line: string) => void;

	constructor(handler: (line: string) => void) {
		this.handler = handler;
	}

	push(chunk: string): void {
		this.buffer += chunk;
		const lines = this.buffer.split("\n");
		// Keep the last (possibly incomplete) line in the buffer
		this.buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (line.trim()) {
				this.handler(line);
			}
		}
	}

	flush(): void {
		if (this.buffer.trim()) {
			this.handler(this.buffer);
			this.buffer = "";
		}
	}
}
