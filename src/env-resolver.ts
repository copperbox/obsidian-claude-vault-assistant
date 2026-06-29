import { execFileSync } from "child_process";

/**
 * Injectable dependencies for {@link resolveSpawnEnv}, so the login-shell probe
 * can be exercised in tests without spawning a real shell.
 */
export interface EnvResolverDeps {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	shell: string | undefined;
	runProbe: (command: string, args: string[]) => string;
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * Build the login-shell command that dumps the environment.
 *
 * Mirrors the `$SHELL -l -c` technique used by the one-off runner: a login
 * shell sources ~/.bash_profile, ~/.zshrc, etc., so any exports defined there
 * become visible.
 */
export function buildEnvProbeCommand(shell: string): {
	command: string;
	args: string[];
} {
	return { command: shell, args: ["-l", "-c", "env"] };
}

/**
 * Parse `env` output into a key/value map. Only lines of the form `KEY=value`
 * are kept; anything else (banner text, the trailing blank line, or the rare
 * embedded newline inside a multi-line value) is ignored. The variables this
 * exists to recover -- PATH and the ANTHROPIC_* settings -- are single-line, so
 * this trade keeps parsing unambiguous.
 */
export function parseEnvOutput(output: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of output.split("\n")) {
		const match = KEY_LINE.exec(line);
		if (match) {
			result[match[1]!] = match[2]!;
		}
	}
	return result;
}

/** Merge harvested vars over a base environment; harvested values win. */
export function mergeEnv(
	base: NodeJS.ProcessEnv,
	harvested: Record<string, string>
): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const [key, value] of Object.entries(base)) {
		if (typeof value === "string") merged[key] = value;
	}
	for (const [key, value] of Object.entries(harvested)) {
		merged[key] = value;
	}
	return merged;
}

function defaultDeps(): EnvResolverDeps {
	return {
		platform: process.platform,
		env: process.env,
		shell: process.env.SHELL,
		runProbe: (command, args) =>
			execFileSync(command, args, { encoding: "utf8", timeout: 5000 }),
	};
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") result[key] = value;
	}
	return result;
}

/**
 * Resolve the environment to hand to the spawned Claude CLI.
 *
 * GUI apps (Electron/Obsidian) on macOS/Linux don't inherit the user's shell
 * environment, so login-shell exports like PATH, ANTHROPIC_BASE_URL, and
 * ANTHROPIC_AUTH_TOKEN are missing from process.env. The one-off runner solves
 * this by wrapping the CLI in `$SHELL -l -c ...`; the Agent SDK spawns the CLI
 * directly, so instead we source the login shell once here and merge its
 * environment over process.env, then pass the result to the SDK's `env` option.
 *
 * On Windows the full environment is already available, so process.env passes
 * through unchanged. If the probe fails for any reason we fall back to
 * process.env rather than breaking the session.
 */
export function resolveSpawnEnv(
	overrides?: Partial<EnvResolverDeps>
): Record<string, string> {
	const deps = { ...defaultDeps(), ...overrides };

	if (deps.platform === "win32") {
		return stringEnv(deps.env);
	}

	const shell = deps.shell || "/bin/bash";
	try {
		const { command, args } = buildEnvProbeCommand(shell);
		const output = deps.runProbe(command, args);
		const harvested = parseEnvOutput(output);
		return mergeEnv(deps.env, harvested);
	} catch (err) {
		console.warn(
			"claude-vault-assistant: failed to harvest login-shell environment; " +
				"falling back to process.env.",
			err
		);
		return stringEnv(deps.env);
	}
}
