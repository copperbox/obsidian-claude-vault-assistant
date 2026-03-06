import type { App, Vault } from "obsidian";

/** Tools that modify files on disk. */
const FILE_MUTATING_TOOLS = new Set(["Write", "Edit"]);

export class VaultRefresher {
	private modifiedPaths = new Set<string>();

	/** Record a tool use event; tracks the file path if it's a mutating tool. */
	trackToolUse(toolName: string, filePath?: string): void {
		if (filePath && FILE_MUTATING_TOOLS.has(toolName)) {
			this.modifiedPaths.add(filePath);
		}
	}

	/** Returns the set of file paths that were modified during this run. */
	getModifiedPaths(): ReadonlySet<string> {
		return this.modifiedPaths;
	}

	/** Clear tracked paths (call when starting a new run). */
	clear(): void {
		this.modifiedPaths.clear();
	}

	/**
	 * Trigger Obsidian to re-read all files that were modified during the run.
	 * Uses vault adapter to read fresh content from disk into Obsidian's cache.
	 */
	async refreshModifiedFiles(app: App): Promise<void> {
		const vault: Vault = app.vault;
		const adapter = vault.adapter;

		const refreshPromises: Promise<void>[] = [];

		for (const filePath of this.modifiedPaths) {
			refreshPromises.push(this.refreshFile(vault, adapter, filePath));
		}

		await Promise.allSettled(refreshPromises);
	}

	private async refreshFile(
		vault: Vault,
		adapter: Vault["adapter"],
		filePath: string
	): Promise<void> {
		const exists = await adapter.exists(filePath);
		if (!exists) {
			// File was deleted by Claude — remove from Obsidian's cache
			const abstractFile = vault.getAbstractFileByPath(filePath);
			if (abstractFile) {
				vault.trigger("delete", abstractFile);
			}
			return;
		}

		// Read fresh content from disk to update Obsidian's internal cache
		const content = await adapter.read(filePath);
		const existingFile = vault.getAbstractFileByPath(filePath);

		if (existingFile) {
			// File already known to Obsidian — trigger modify to refresh editors
			await vault.modify(existingFile as Parameters<typeof vault.modify>[0], content);
		} else {
			// New file created by Claude — create it in Obsidian's file tree
			// The file already exists on disk, so we just need Obsidian to notice it
			// Triggering a folder re-scan by reading forces cache update
			vault.trigger("create", { path: filePath });
		}
	}
}
