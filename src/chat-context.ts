/**
 * Pure helpers for attaching Obsidian view context to an interactive chat turn.
 *
 * The chat delivers context "by reference": rather than inlining note bodies,
 * it prepends a short line naming the notes as [[wiki links]] and asks Claude to
 * read them (via its Read tool, with the vault as cwd) if they are relevant. This
 * keeps per-turn token cost near zero and always reflects the note's on-disk state.
 */

/**
 * Convert a vault-relative note path to an Obsidian wiki-link target: drop a
 * trailing ".md" extension, keep the folder structure.
 * "Daily/2026-06-30.md" -> "Daily/2026-06-30"
 */
export function pathToWikiLink(path: string): string {
	return path.replace(/\.md$/i, "");
}

/**
 * Build the reference-only context preamble prepended to a user turn. Lists the
 * given notes as wiki links and tells Claude to read them if relevant. Returns
 * "" when there are no notes, so callers add no preamble at all.
 */
export function buildContextPreamble(paths: string[]): string {
	if (paths.length === 0) return "";
	const links = paths.map((p) => `[[${pathToWikiLink(p)}]]`).join(", ");
	const pronoun = paths.length === 1 ? "it" : "them";
	return `Currently viewing in Obsidian: ${links}. Read ${pronoun} if relevant to my question.`;
}

/**
 * Compose the message actually sent to the model: the context preamble (if any),
 * a blank line, then the user's text. When the preamble is empty the user text is
 * returned unchanged.
 */
export function composeMessage(preamble: string, userText: string): string {
	return preamble ? `${preamble}\n\n${userText}` : userText;
}
