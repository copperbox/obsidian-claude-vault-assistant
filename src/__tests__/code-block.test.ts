import { describe, it, expect } from "vitest";
import { languageFromClass } from "../code-block";

describe("languageFromClass", () => {
	it("extracts the language from an Obsidian code class", () => {
		expect(languageFromClass("language-bash")).toBe("bash");
	});

	it("ignores extra classes like is-loaded", () => {
		expect(languageFromClass("language-python is-loaded")).toBe("python");
		expect(languageFromClass("is-loaded language-js")).toBe("js");
	});

	it("lowercases the language", () => {
		expect(languageFromClass("language-JS")).toBe("js");
	});

	it("supports languages with symbols", () => {
		expect(languageFromClass("language-c++")).toBe("c++");
		expect(languageFromClass("language-c#")).toBe("c#");
		expect(languageFromClass("language-objective-c")).toBe("objective-c");
	});

	it("returns null when no language token is present", () => {
		expect(languageFromClass("")).toBeNull();
		expect(languageFromClass("some-other-class")).toBeNull();
		expect(languageFromClass("language-")).toBeNull();
	});

	it("does not match a non-boundary 'language-' substring", () => {
		expect(languageFromClass("mylanguage-x")).toBeNull();
	});
});
