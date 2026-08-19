/** Whether a prompt-launched chat targets the whole vault or just the active note. */
export type RunScope = "vault" | "note";

/**
 * Build the first user message for a prompt-launched chat. Note scope restricts
 * edits to the active note by prepending an instruction. Pure -- unit tested.
 */
export function buildPromptText(
	scope: RunScope,
	promptBody: string,
	activeNotePath?: string
): string {
	if (scope === "note") {
		if (!activeNotePath) {
			throw new Error("Note scope requires an active note path");
		}
		return `Only make edits to this note: ${activeNotePath}\n${promptBody}`;
	}
	return promptBody;
}
