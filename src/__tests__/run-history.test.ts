import { describe, it, expect } from "vitest";
import {
	addEntry,
	pruneHistory,
	clearHistory,
	generateEntryId,
	formatDuration,
	formatTimestamp,
	type RunHistoryEntry,
} from "../run-history";

function makeEntry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
	return {
		id: generateEntryId(),
		promptName: "Test Prompt",
		scope: "vault",
		timestamp: Date.now(),
		durationMs: 5000,
		status: "success",
		output: "# Result\nSome output",
		...overrides,
	};
}

describe("run-history", () => {
	describe("generateEntryId", () => {
		it("generates unique IDs", () => {
			const id1 = generateEntryId();
			const id2 = generateEntryId();
			expect(id1).not.toBe(id2);
		});

		it("generates string IDs", () => {
			expect(typeof generateEntryId()).toBe("string");
		});
	});

	describe("addEntry", () => {
		it("adds entry to empty history", () => {
			const entry = makeEntry();
			const result = addEntry([], entry, 50);
			expect(result).toHaveLength(1);
			expect(result[0]).toBe(entry);
		});

		it("prepends new entry (most recent first)", () => {
			const old = makeEntry({ promptName: "Old" });
			const fresh = makeEntry({ promptName: "New" });
			const result = addEntry([old], fresh, 50);
			expect(result).toHaveLength(2);
			expect(result[0]!.promptName).toBe("New");
			expect(result[1]!.promptName).toBe("Old");
		});

		it("prunes oldest entries when exceeding max", () => {
			const existing = Array.from({ length: 5 }, (_, i) =>
				makeEntry({ promptName: `Entry ${i}` })
			);
			const fresh = makeEntry({ promptName: "Newest" });
			const result = addEntry(existing, fresh, 5);
			expect(result).toHaveLength(5);
			expect(result[0]!.promptName).toBe("Newest");
			expect(result[4]!.promptName).toBe("Entry 3");
		});

		it("handles max of 1", () => {
			const existing = [makeEntry({ promptName: "Old" })];
			const fresh = makeEntry({ promptName: "New" });
			const result = addEntry(existing, fresh, 1);
			expect(result).toHaveLength(1);
			expect(result[0]!.promptName).toBe("New");
		});
	});

	describe("pruneHistory", () => {
		it("returns unchanged if under limit", () => {
			const entries = [makeEntry(), makeEntry()];
			const result = pruneHistory(entries, 50);
			expect(result).toHaveLength(2);
		});

		it("trims to max entries", () => {
			const entries = Array.from({ length: 10 }, () => makeEntry());
			const result = pruneHistory(entries, 3);
			expect(result).toHaveLength(3);
		});

		it("returns all entries if maxEntries is 0", () => {
			const entries = [makeEntry(), makeEntry()];
			const result = pruneHistory(entries, 0);
			expect(result).toHaveLength(2);
		});

		it("keeps earliest items (first in array)", () => {
			const entries = [
				makeEntry({ promptName: "First" }),
				makeEntry({ promptName: "Second" }),
				makeEntry({ promptName: "Third" }),
			];
			const result = pruneHistory(entries, 2);
			expect(result[0]!.promptName).toBe("First");
			expect(result[1]!.promptName).toBe("Second");
		});
	});

	describe("clearHistory", () => {
		it("returns empty array", () => {
			expect(clearHistory()).toEqual([]);
		});
	});

	describe("formatDuration", () => {
		it("formats seconds for short durations", () => {
			expect(formatDuration(5000)).toBe("5.0s");
		});

		it("formats sub-second durations", () => {
			expect(formatDuration(500)).toBe("0.5s");
		});

		it("formats minutes and seconds for longer durations", () => {
			expect(formatDuration(125000)).toBe("2m 5s");
		});

		it("formats exactly one minute", () => {
			expect(formatDuration(60000)).toBe("1m 0s");
		});
	});

	describe("formatTimestamp", () => {
		it("formats a timestamp as YYYY-MM-DD HH:MM", () => {
			// Use a fixed date to avoid timezone issues
			const date = new Date(2026, 2, 6, 14, 30); // March 6, 2026 14:30
			const result = formatTimestamp(date.getTime());
			expect(result).toBe("2026-03-06 14:30");
		});

		it("zero-pads single-digit months and days", () => {
			const date = new Date(2026, 0, 5, 9, 5); // Jan 5, 2026 09:05
			const result = formatTimestamp(date.getTime());
			expect(result).toBe("2026-01-05 09:05");
		});
	});

	describe("RunHistoryEntry fields", () => {
		it("stores all required fields", () => {
			const entry = makeEntry({
				promptName: "Summarize",
				scope: "note",
				status: "error",
				costUsd: 0.05,
				notePath: "notes/test.md",
				output: "Error occurred",
			});
			expect(entry.promptName).toBe("Summarize");
			expect(entry.scope).toBe("note");
			expect(entry.status).toBe("error");
			expect(entry.costUsd).toBe(0.05);
			expect(entry.notePath).toBe("notes/test.md");
			expect(entry.output).toBe("Error occurred");
		});

		it("allows optional fields to be undefined", () => {
			const entry = makeEntry();
			expect(entry.costUsd).toBeUndefined();
			expect(entry.notePath).toBeUndefined();
		});
	});
});
