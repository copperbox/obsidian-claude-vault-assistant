import { describe, it, expect, vi } from "vitest";
import { AdhocPromptModal } from "../adhoc-prompt-modal";

describe("AdhocPromptModal", () => {
	it("is constructable", () => {
		const modal = new AdhocPromptModal({} as never, vi.fn());
		expect(modal).toBeDefined();
	});

	it("onOpen creates heading and settings without throwing", () => {
		const modal = new AdhocPromptModal({} as never, vi.fn());
		modal.onOpen();
	});

	it("does not call onSubmit when prompt is empty", () => {
		const onSubmit = vi.fn();
		const modal = new AdhocPromptModal({} as never, onSubmit);
		// Access private submit via casting
		(modal as unknown as { submit: () => void }).submit();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("does not call onSubmit when prompt is whitespace only", () => {
		const onSubmit = vi.fn();
		const modal = new AdhocPromptModal({} as never, onSubmit);
		// Set promptText to whitespace
		(modal as unknown as { promptText: string }).promptText = "   \n\t  ";
		(modal as unknown as { submit: () => void }).submit();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("calls onSubmit with trimmed text when prompt has content", () => {
		const onSubmit = vi.fn();
		const modal = new AdhocPromptModal({} as never, onSubmit);
		(modal as unknown as { promptText: string }).promptText = "  summarize this note  ";
		(modal as unknown as { submit: () => void }).submit();
		expect(onSubmit).toHaveBeenCalledWith("summarize this note");
	});

	it("onClose empties contentEl", () => {
		const modal = new AdhocPromptModal({} as never, vi.fn());
		const emptySpy = vi.fn();
		modal.contentEl = { empty: emptySpy } as never;
		modal.onClose();
		expect(emptySpy).toHaveBeenCalled();
	});
});
