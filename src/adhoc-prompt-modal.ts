import { type App, Modal, Setting } from "obsidian";

export class AdhocPromptModal extends Modal {
	private promptText = "";
	private onSubmit: (prompt: string) => void;

	constructor(app: App, onSubmit: (prompt: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("adhoc-prompt-modal");
		contentEl.createEl("h3", { text: "Quick prompt" });
		const textarea = contentEl.createEl("textarea");
		textarea.placeholder = "What should Claude do?";
		textarea.rows = 8;
		textarea.addClass("adhoc-prompt-textarea");
		textarea.addEventListener("input", () => {
			this.promptText = textarea.value;
		});
		textarea.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.submit();
			}
		});
		setTimeout(() => textarea.focus(), 10);

		contentEl.createEl("small", {
			text: "Ctrl+Enter to submit",
			cls: "adhoc-prompt-hint",
		});

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText("Run").setCta().onClick(() => this.submit());
		});
	}

	private submit(): void {
		const text = this.promptText.trim();
		if (!text) return;
		this.close();
		this.onSubmit(text);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
