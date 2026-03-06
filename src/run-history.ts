import type { RunScope } from "./claude-runner";

export interface RunHistoryEntry {
	id: string;
	promptName: string;
	scope: RunScope;
	timestamp: number;
	durationMs: number;
	status: "success" | "error" | "stopped" | "limit";
	costUsd?: number;
	notePath?: string;
	output: string;
}

export function generateEntryId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addEntry(
	history: RunHistoryEntry[],
	entry: RunHistoryEntry,
	maxEntries: number
): RunHistoryEntry[] {
	const updated = [entry, ...history];
	return pruneHistory(updated, maxEntries);
}

export function pruneHistory(
	history: RunHistoryEntry[],
	maxEntries: number
): RunHistoryEntry[] {
	if (maxEntries <= 0) return history;
	return history.slice(0, maxEntries);
}

export function clearHistory(): RunHistoryEntry[] {
	return [];
}

export function formatDuration(ms: number): string {
	const secs = ms / 1000;
	if (secs < 60) return `${secs.toFixed(1)}s`;
	const mins = Math.floor(secs / 60);
	const remainSecs = Math.round(secs % 60);
	return `${mins}m ${remainSecs}s`;
}

export function formatTimestamp(ts: number): string {
	const date = new Date(ts);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}`;
}
