// Counts how many times option parsers build a mismatch diagnostic during one
// successful parse of positional tokens.
//
// Each option carries a function-valued `errors.noMatch` that increments a
// counter, as the reproduction in https://github.com/dahlia/optique/issues/988
// does.  The count involves no timing, so it is the same on every machine: on
// @optique/core 1.3.6 it equals tokens times options, and on builds that
// include https://github.com/dahlia/optique/pull/997 it is zero.
//
// This file runs unchanged on Node, Deno and Bun, against an installed
// @optique/core as well as against a source checkout; README.md gives the
// command for each way of running it.
//
// It prints exactly one JSON line on stdout.  With --assert-zero it exits with
// status 1 when the count is not zero.

import { object } from "@optique/core/constructs";
import { formatMessage, message } from "@optique/core/message";
import { multiple, optional } from "@optique/core/modifiers";
import { parseSync } from "@optique/core/parser";
import { argument, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const programName = "mismatch-count.ts";

const usage = [
  `Usage: ${programName} [options]`,
  "",
  "  --tokens <count>   number of positional tokens to parse (default: 1000)",
  "  --options <count>  number of option parsers in the object (default: 30)",
  "  --assert-zero      exit with status 1 unless no diagnostic was built",
  "  --help             print this text and exit",
].join("\n");

//region Runtime detection
// Deno and Bun both expose `process`, but neither their own globals nor Node's
// types can be imported by a script that may depend on nothing else, so the
// globals are looked up as properties of `globalThis`.

type ProcessGlobal = {
  readonly argv?: readonly string[];
  readonly versions?: Readonly<Record<string, string | undefined>>;
  exitCode?: number;
};

const globalScope = globalThis as typeof globalThis & {
  readonly Deno?: { readonly version: { readonly deno: string } };
  readonly Bun?: { readonly version: string };
  readonly process?: ProcessGlobal;
};

function describeRuntime(): { runtime: string; runtimeVersion: string } {
  if (globalScope.Deno != null) {
    return { runtime: "deno", runtimeVersion: globalScope.Deno.version.deno };
  }
  if (globalScope.Bun != null) {
    return { runtime: "bun", runtimeVersion: globalScope.Bun.version };
  }
  const version = globalScope.process?.versions?.["node"];
  if (version == null) {
    throw new Error("cannot identify the JavaScript runtime");
  }
  return { runtime: "node", runtimeVersion: version };
}

function readCommandLine(): readonly string[] {
  const argv = globalScope.process?.argv;
  if (argv == null) throw new Error("cannot read the command line arguments");
  return argv.slice(2);
}

// Which copy of the library was actually loaded, so that a run against the
// wrong version, or against dist instead of src, is visible in the result.
function describeLibrary(): string {
  const meta = import.meta as { readonly resolve?: (id: string) => string };
  return meta.resolve?.("@optique/core/primitives") ?? "unresolved";
}
//endregion

//region Options
class UsageError extends Error {
  constructor(reason: string) {
    super(`${reason}\n\n${usage}`);
    this.name = "UsageError";
  }
}

type Options = {
  readonly tokenCount: number;
  readonly optionCount: number;
  readonly assertZero: boolean;
};

function readNumber(
  argv: readonly string[],
  index: number,
  name: string,
): number {
  const raw = argv[index];
  if (raw == null) throw new UsageError(`${name} needs a value`);
  if (!/^\d+$/.test(raw)) throw new UsageError(`${name} needs a number`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new UsageError(`${name} needs a whole number, 1 or more`);
  }
  return value;
}

// Returns null when the caller asked for the usage text instead of a run.
function parseOptions(argv: readonly string[]): Options | null {
  let tokenCount = 1000;
  let optionCount = 30;
  let assertZero = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    switch (token) {
      case "--tokens":
        tokenCount = readNumber(argv, index + 1, token);
        index += 1;
        break;
      case "--options":
        optionCount = readNumber(argv, index + 1, token);
        index += 1;
        break;
      case "--assert-zero":
        assertZero = true;
        break;
      case "--help":
        return null;
      default:
        throw new UsageError(`unknown option ${JSON.stringify(token)}`);
    }
  }
  return { tokenCount, optionCount, assertZero };
}
//endregion

function main(): void {
  const options = parseOptions(readCommandLine());
  if (options == null) {
    console.error(usage);
    return;
  }

  let mismatchDiagnostics = 0;
  const fields = Object.fromEntries(
    Array.from({ length: options.optionCount }, (_, index) => [
      `option${index}`,
      optional(option(`--option-${index}`, string(), {
        errors: {
          noMatch: () => {
            mismatchDiagnostics += 1;
            return message`No match.`;
          },
        },
      })),
    ]),
  );
  const parser = object({
    ...fields,
    paths: multiple(argument(string())),
  });

  const expected = Array.from(
    { length: options.tokenCount },
    (_, index) => `src/component-${index}/filename.ts`,
  );
  const result = parseSync(parser, expected);
  if (!result.success) {
    throw new Error(`the parse failed: ${formatMessage(result.error)}`);
  }
  const parsed = (result.value as { readonly paths: readonly string[] }).paths;
  if (parsed.length !== options.tokenCount) {
    throw new Error(
      `parsed ${parsed.length} of ${options.tokenCount} tokens`,
    );
  }

  console.log(
    JSON.stringify({
      script: "mismatch-count",
      ...describeRuntime(),
      library: describeLibrary(),
      tokens: options.tokenCount,
      options: options.optionCount,
      parsedTokens: parsed.length,
      mismatchDiagnostics,
      tokensTimesOptions: options.tokenCount * options.optionCount,
    }),
  );

  if (options.assertZero && mismatchDiagnostics !== 0) {
    console.error(
      `${mismatchDiagnostics} mismatch diagnostics were built during a parse that succeeded.`,
    );
    if (globalScope.process != null) globalScope.process.exitCode = 1;
  }
}

main();
