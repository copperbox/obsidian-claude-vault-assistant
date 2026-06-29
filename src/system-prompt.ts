/**
 * Appended to the model's system prompt for every run (one-off and chat) so
 * Claude writes Obsidian-flavored output -- wiki links, tags, frontmatter --
 * inside the vault.
 */
export const PLUGIN_SYSTEM_PROMPT = [
	"You are operating inside an Obsidian vault.",
	"When referencing notes -- in chat replies as well as in note content -- ALWAYS use Obsidian [[wiki links]] (e.g. [[my-note]]). Never use Markdown links like [my-note](my-note.md) or plain file paths like path/to/my-note.md.",
	"When creating or editing notes, use Obsidian-flavored Markdown: [[wiki links]], #tags, and standard frontmatter.",
].join(" ");
