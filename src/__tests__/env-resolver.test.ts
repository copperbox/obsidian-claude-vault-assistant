import { describe, it, expect, vi } from "vitest";
import {
	buildEnvProbeCommand,
	parseEnvOutput,
	mergeEnv,
	resolveSpawnEnv,
} from "../env-resolver";

describe("buildEnvProbeCommand", () => {
	it("wraps env in a login shell", () => {
		expect(buildEnvProbeCommand("/bin/zsh")).toEqual({
			command: "/bin/zsh",
			args: ["-l", "-c", "env"],
		});
	});
});

describe("parseEnvOutput", () => {
	it("parses simple KEY=VALUE lines", () => {
		const out = "PATH=/usr/bin\nANTHROPIC_BASE_URL=https://example.com\n";
		expect(parseEnvOutput(out)).toEqual({
			PATH: "/usr/bin",
			ANTHROPIC_BASE_URL: "https://example.com",
		});
	});

	it("keeps values that contain equals signs", () => {
		const out = "TOKEN=abc=def=ghi";
		expect(parseEnvOutput(out)).toEqual({ TOKEN: "abc=def=ghi" });
	});

	it("ignores lines that are not KEY=value (incl. trailing blank line)", () => {
		const out = "MULTI=line one\nstray continuation\nNEXT=value\n";
		expect(parseEnvOutput(out)).toEqual({
			MULTI: "line one",
			NEXT: "value",
		});
	});

	it("ignores leading junk before the first key", () => {
		const out = "some banner text\nKEY=value";
		expect(parseEnvOutput(out)).toEqual({ KEY: "value" });
	});

	it("handles empty values", () => {
		expect(parseEnvOutput("EMPTY=")).toEqual({ EMPTY: "" });
	});
});

describe("mergeEnv", () => {
	it("lets harvested values override the base", () => {
		const merged = mergeEnv(
			{ PATH: "/base", KEEP: "yes" },
			{ PATH: "/harvested", EXTRA: "added" }
		);
		expect(merged).toEqual({
			PATH: "/harvested",
			KEEP: "yes",
			EXTRA: "added",
		});
	});

	it("drops undefined base values", () => {
		const merged = mergeEnv(
			{ DEFINED: "x", MISSING: undefined },
			{ EXTRA: "y" }
		);
		expect(merged).toEqual({ DEFINED: "x", EXTRA: "y" });
	});
});

describe("resolveSpawnEnv", () => {
	it("passes process.env through unchanged on Windows without probing", () => {
		const runProbe = vi.fn();
		const result = resolveSpawnEnv({
			platform: "win32",
			env: { PATH: "C:/bin", FOO: "bar", MISSING: undefined },
			shell: undefined,
			runProbe,
		});
		expect(result).toEqual({ PATH: "C:/bin", FOO: "bar" });
		expect(runProbe).not.toHaveBeenCalled();
	});

	it("harvests and merges the login-shell environment on non-Windows", () => {
		const runProbe = vi.fn(
			() => "PATH=/login/bin\nANTHROPIC_AUTH_TOKEN=secret\n"
		);
		const result = resolveSpawnEnv({
			platform: "darwin",
			env: { PATH: "/gui/bin", HOME: "/Users/me" },
			shell: "/bin/zsh",
			runProbe,
		});
		expect(runProbe).toHaveBeenCalledWith("/bin/zsh", ["-l", "-c", "env"]);
		// Login PATH wins; HOME from base is preserved; token is added.
		expect(result).toEqual({
			PATH: "/login/bin",
			HOME: "/Users/me",
			ANTHROPIC_AUTH_TOKEN: "secret",
		});
	});

	it("defaults to /bin/bash when SHELL is unset", () => {
		const runProbe = vi.fn(() => "");
		resolveSpawnEnv({
			platform: "linux",
			env: {},
			shell: undefined,
			runProbe,
		});
		expect(runProbe).toHaveBeenCalledWith("/bin/bash", ["-l", "-c", "env"]);
	});

	it("falls back to process.env when the probe throws", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const runProbe = vi.fn(() => {
			throw new Error("shell missing");
		});
		const result = resolveSpawnEnv({
			platform: "linux",
			env: { PATH: "/gui/bin" },
			shell: "/bin/bash",
			runProbe,
		});
		expect(result).toEqual({ PATH: "/gui/bin" });
		warn.mockRestore();
	});
});
