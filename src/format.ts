/**
 * Shared formatting for the cost/time/tokens breakdown shown after a one-off
 * run completes and after each interactive chat turn. Centralized here so both
 * surfaces render the same line.
 */

/**
 * Total tokens consumed by a turn: prompt + output + both cache buckets. The
 * CLI's `result` event carries these under a `usage` object. Returns undefined
 * when the result carried no usage data (so callers can omit the field).
 */
export function sumUsageTokens(usage: unknown): number | undefined {
	if (!usage || typeof usage !== "object") return undefined;
	const u = usage as Record<string, unknown>;
	const fields = [
		"input_tokens",
		"output_tokens",
		"cache_creation_input_tokens",
		"cache_read_input_tokens",
	];
	let total = 0;
	let found = false;
	for (const field of fields) {
		const value = u[field];
		if (typeof value === "number") {
			total += value;
			found = true;
		}
	}
	return found ? total : undefined;
}

/** Format a token count with thousands separators, e.g. 12345 -> "12,345". */
export function formatTokens(tokens: number): string {
	return Math.round(tokens)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export interface ResultMeta {
	costUsd?: number;
	durationMs?: number;
	tokens?: number;
}

/**
 * Build the one-line breakdown shown after a turn, e.g.
 * "$0.0123 - 4.5s - 12,345 tokens". Any missing field is omitted; returns ""
 * when nothing is available so callers can skip rendering an empty line.
 */
export function formatResultMeta(meta: ResultMeta): string {
	const parts: string[] = [];
	if (meta.costUsd !== undefined) parts.push(`$${meta.costUsd.toFixed(4)}`);
	if (meta.durationMs !== undefined) {
		parts.push(`${(meta.durationMs / 1000).toFixed(1)}s`);
	}
	if (meta.tokens !== undefined) {
		parts.push(`${formatTokens(meta.tokens)} tokens`);
	}
	return parts.join(" - ");
}
