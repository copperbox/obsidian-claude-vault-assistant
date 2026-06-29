/**
 * Extract a fenced code block's language from a class list. Obsidian renders
 * ```lang fences as `<code class="language-lang ...">` (and sometimes puts the
 * class on the `<pre>`). Returns the lowercased language, or null when none is
 * present.
 */
export function languageFromClass(className: string): string | null {
	const match = className.match(/(?:^|\s)language-([\w#+.-]+)/i);
	return match ? match[1]!.toLowerCase() : null;
}

/**
 * Add a small language label to each fenced code block under `container`.
 * Idempotent per block and a no-op for fences with no language. Call after
 * MarkdownRenderer.render() resolves.
 */
export function labelCodeBlocks(container: HTMLElement): void {
	const codeEls = container.querySelectorAll<HTMLElement>("pre > code");
	codeEls.forEach((code) => {
		const pre = code.parentElement;
		if (!pre || pre.querySelector(".claude-code-lang")) return;
		const lang =
			languageFromClass(code.className) ?? languageFromClass(pre.className);
		if (!lang) return;
		pre.addClass("claude-has-lang");
		pre.createDiv({ cls: "claude-code-lang", text: lang });
	});
}
