/**
 * Shared rendering for Claude tool calls, used by both the one-off output view
 * and the interactive chat view. A tool call renders as a collapsible
 * `<details>` element whose status badge flips from pending to success/error
 * once the matching tool result arrives.
 */

export interface ToolCallEls {
	summary: HTMLElement;
	details: HTMLElement;
	statusEl: HTMLElement;
}

/**
 * For Write/Edit, replace large content fields with a size summary so the tool
 * input stays readable in the panel.
 */
export function filterToolInput(
	toolName: string,
	input: Record<string, unknown>
): Record<string, unknown> {
	const omitKeys: Record<string, string[]> = {
		Write: ["content"],
		Edit: ["new_string", "old_string"],
	};
	const keysToOmit = omitKeys[toolName];
	if (!keysToOmit) return input;

	const filtered: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (keysToOmit.includes(key) && typeof value === "string") {
			filtered[key] = `(${value.length} chars)`;
		} else {
			filtered[key] = value;
		}
	}
	return filtered;
}

/** Render a pending tool call into `container` and return its element refs. */
export function renderToolCall(
	container: HTMLElement,
	opts: {
		toolName: string;
		filePath?: string;
		input?: Record<string, unknown>;
	}
): ToolCallEls {
	const details = container.createEl("details", { cls: "claude-tool-call" });

	const summary = details.createEl("summary", {
		cls: "claude-tool-call-summary",
	});

	const statusEl = summary.createSpan({
		cls: "claude-tool-call-status claude-tool-call-status-pending",
		text: "…",
	});
	statusEl.setAttr("aria-label", "pending");

	summary.createSpan({ text: opts.toolName, cls: "claude-tool-call-name" });
	if (opts.filePath) {
		summary.createSpan({ text: opts.filePath, cls: "claude-tool-call-path" });
	}

	if (opts.input && Object.keys(opts.input).length > 0) {
		const body = details.createDiv({ cls: "claude-tool-call-input" });
		const filtered = filterToolInput(opts.toolName, opts.input);
		body.createEl("pre", { text: JSON.stringify(filtered, null, 2) });
	}

	return { summary, details, statusEl };
}

/** Flip a rendered tool call to its success/error state and append output. */
export function renderToolResult(
	els: ToolCallEls,
	isError: boolean,
	content: string
): void {
	const { summary, details, statusEl } = els;

	statusEl.removeClass("claude-tool-call-status-pending");
	if (isError) {
		statusEl.addClass("claude-tool-call-status-error");
		statusEl.setText("✗");
		statusEl.setAttr("aria-label", "error");
		summary.addClass("claude-tool-call-summary-error");
		details.setAttr("open", "");
	} else {
		statusEl.addClass("claude-tool-call-status-success");
		statusEl.setText("✓");
		statusEl.setAttr("aria-label", "success");
	}

	if (content) {
		const resultEl = details.createDiv({
			cls: isError
				? "claude-tool-call-result claude-tool-call-result-error"
				: "claude-tool-call-result",
		});
		resultEl.createEl("pre", { text: content });
	}
}
