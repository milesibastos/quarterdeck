import { execFile } from "node:child_process";

/**
 * Running a command, as a dependency.
 *
 * quarterdeck:permitted-spawner
 *
 * The fleet publishes its snapshot through a command, not a file, so reading a
 * real fleet means starting a process. That capability is confined here for the
 * same reason writing is confined to `src/adapters/intent.ts`: the question
 * "what can this panel start?" has to be answerable by reading one file.
 *
 * This door only reads. It hands back a command's standard output and nothing
 * else - no shell, no stdin, no working-directory change - so the argument that
 * the panel cannot act on a fleet survives the arrival of a real source. The
 * command is passed as a path with an argument list, never as a shell string,
 * so nothing here can be turned into a shell by a value from configuration.
 *
 * Injected as an interface so a test can drive the adapter with a stub runner
 * and no fleet, which is what keeps the whole read path testable from fixtures.
 */

export interface RunOptions {
  /** The child's whole environment. Not merged with this process's. */
  readonly env: Readonly<Record<string, string>>;
  /** Abort kills the child. The runtime's read timeout arrives this way. */
  readonly signal: AbortSignal;
}

export interface Runner {
  /** Standard output, decoded as UTF-8. Rejects with `CommandError` otherwise. */
  run(
    command: string,
    args: readonly string[],
    options: RunOptions,
  ): Promise<string>;
}

/**
 * A command that did not produce output this process can use.
 *
 * Carries the exit code and what the command said on standard error, because
 * the operator-facing line the panel shows for a failed read is built from it -
 * "no such file" and "exit 2: FM_HOME is not a fleet home" call for different
 * corrections, and a bare "read failed" tells the reader neither.
 */
export class CommandError extends Error {
  override readonly name = "CommandError";
  readonly command: string;
  readonly exitCode: number | null;
  readonly stderr: string;

  // Written out rather than declared as constructor parameters: the test suite
  // runs TypeScript through Node's strip-only loader, which cannot erase a
  // parameter property, and this file is reached from tests.
  constructor(
    command: string,
    exitCode: number | null,
    stderr: string,
    detail: string,
  ) {
    super(
      `${command} ${exitCode === null ? detail : `exited ${exitCode}`}` +
        (stderr
          ? `: ${stderr}`
          : detail && exitCode !== null
            ? `: ${detail}`
            : ""),
    );
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * A fleet's snapshot is tens of kilobytes today and grows with the fleet.
 * Node's own default is one megabyte, which a large fleet would silently
 * exceed - silently, because the process is killed and the output truncated.
 */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** How much of a failing command's standard error is worth showing an operator. */
const STDERR_LIMIT = 500;

function firstLines(text: string): string {
  return text.trim().split("\n").slice(0, 3).join(" ").slice(0, STDERR_LIMIT);
}

export const childProcessRunner: Runner = {
  run(command, args, { env, signal }) {
    return new Promise<string>((resolve, reject) => {
      execFile(
        command,
        [...args],
        {
          // Next augments NodeJS.ProcessEnv with a required NODE_ENV, so a
          // plain environment map is not assignable to it. The child is given
          // exactly what the caller assembled either way.
          env: env as NodeJS.ProcessEnv,
          signal,
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT_BYTES,
        },
        (
          error: (Error & { code?: unknown }) | null,
          stdout: string,
          stderr: string,
        ) => {
          if (!error) return resolve(stdout);
          // `code` is the exit status for a command that ran and failed, and
          // absent when the failure was this side of it - not found, aborted,
          // output past the buffer. The two read differently to an operator.
          const exitCode = typeof error.code === "number" ? error.code : null;
          reject(
            new CommandError(
              command,
              exitCode,
              firstLines(stderr),
              error.message,
            ),
          );
        },
      );
    });
  },
};
