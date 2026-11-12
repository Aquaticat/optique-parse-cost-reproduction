// Findings 1 and 2: the cost of a successful parse of many positional paths
// through a parser shaped like the `git commit` option set.
//
// This file runs unchanged on Node, Deno and Bun, against an installed
// @optique/core as well as against a source checkout; README.md gives the
// command for each way of running it.
//
// It prints exactly one JSON line on stdout.  Anything that disagrees with the
// request throws instead, so a broken run cannot look like a fast one.

import { object } from "@optique/core/constructs";
import { formatMessage } from "@optique/core/message";
import { multiple, optional } from "@optique/core/modifiers";
import { parseSync } from "@optique/core/parser";
import { argument, flag, option, passThrough } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const programName = "commit-paths.ts";
const messageText = "bench";

const usage = [
  `Usage: ${programName} [options]`,
  "",
  "  --paths <count>   number of positional paths to parse (default: 1000)",
  "  --separator       put -- before the paths, as git commit -- <paths> does",
  "  --runs <count>    number of timed parses (default: 7)",
  "  --warmup <count>  number of untimed parses first (default: 2)",
  "  --help            print this text and exit",
].join("\n");

//region Runtime detection
// Deno and Bun both expose `process`, but neither their own globals nor Node's
// types can be imported by a script that may depend on nothing else, so the
// globals are looked up as properties of `globalThis`.

type ProcessGlobal = {
  readonly argv?: readonly string[];
  readonly versions?: Readonly<Record<string, string | undefined>>;
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
  readonly pathCount: number;
  readonly separator: boolean;
  readonly runs: number;
  readonly warmup: number;
};

function readNumber(
  argv: readonly string[],
  index: number,
  name: string,
  minimum: number,
): number {
  const raw = argv[index];
  if (raw == null) throw new UsageError(`${name} needs a value`);
  if (!/^\d+$/.test(raw)) throw new UsageError(`${name} needs a number`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new UsageError(`${name} needs a whole number, ${minimum} or more`);
  }
  return value;
}

// Returns null when the caller asked for the usage text instead of a run.
function parseOptions(argv: readonly string[]): Options | null {
  let pathCount = 1000;
  let separator = false;
  let runs = 7;
  let warmup = 2;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    switch (token) {
      case "--paths":
        pathCount = readNumber(argv, index + 1, token, 1);
        index += 1;
        break;
      case "--runs":
        runs = readNumber(argv, index + 1, token, 1);
        index += 1;
        break;
      case "--warmup":
        warmup = readNumber(argv, index + 1, token, 0);
        index += 1;
        break;
      case "--separator":
        separator = true;
        break;
      case "--help":
        return null;
      default:
        throw new UsageError(`unknown option ${JSON.stringify(token)}`);
    }
  }
  return { pathCount, separator, runs, warmup };
}
//endregion

//region Parser
// Git accepts any unambiguous prefix of a long option, so every flag Git
// abbreviates declares all of its prefixes, which is what gives this option
// set its size.
function longNamePrefixes(
  name: string,
  shortestStemLength: number,
): [string, ...string[]] {
  const stem = name.slice(2);
  const names: string[] = [];
  for (let length = shortestStemLength; length <= stem.length; length += 1) {
    names.push(`--${stem.slice(0, length)}`);
  }
  const first = names[0];
  if (first == null) {
    throw new Error(`${name} is shorter than ${shortestStemLength} characters`);
  }
  return [first, ...names.slice(1)];
}

const parser = object({
  all: multiple(flag("-a", "--all")),
  only: multiple(flag("-o", "--only")),
  noOnly: multiple(flag("--no-only")),
  include: multiple(flag("-i", ...longNamePrefixes("--include", 3))),
  interactive: multiple(flag("--interactive")),
  patch: multiple(flag("-p", "--patch")),
  amend: multiple(flag("--amend")),
  allowEmpty: multiple(flag("--allow-empty")),
  dryRun: multiple(flag(...longNamePrefixes("--dry-run", 2))),
  short: multiple(flag(...longNamePrefixes("--short", 2))),
  porcelain: multiple(flag(...longNamePrefixes("--porcelain", 3))),
  long: multiple(flag(...longNamePrefixes("--long", 1))),
  nul: multiple(flag("-z", ...longNamePrefixes("--null", 2))),
  message: optional(option("-m", "--message", string())),
  file: optional(option("-F", "--file", string())),
  reuseMessage: optional(option("-C", "--reuse-message", string())),
  reeditMessage: optional(option("-c", "--reedit-message", string())),
  squash: optional(option("--squash", string())),
  fixup: optional(option("--fixup", string())),
  author: optional(option("--author", string())),
  date: optional(option("--date", string())),
  cleanup: optional(option("--cleanup", string())),
  trailer: multiple(option("--trailer", string())),
  template: optional(option("-t", "--template", string())),
  unified: optional(option("-U", "--unified", string())),
  interHunkContext: optional(option("--inter-hunk-context", string())),
  pathspecFromFile: optional(option("--pathspec-from-file", string())),
  pathspecFileNul: multiple(flag("--pathspec-file-nul")),
  paths: multiple(argument(string())),
  unknown: passThrough({ format: "nextToken" }),
});
//endregion

//region Workload
function makePaths(count: number): readonly string[] {
  const paths: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const group = index % 37;
    const directory = `package/group-${group}/package-${index}/src`;
    paths.push(`${directory}/feature-${index}.unit.test.ts`);
  }
  return paths;
}

function makeArguments(
  paths: readonly string[],
  separator: boolean,
): readonly string[] {
  return [
    "--message",
    messageText,
    ...(separator ? ["--"] : []),
    ...paths,
  ];
}
//endregion

function round(value: number): number {
  return Number(value.toFixed(3));
}

function main(): void {
  const options = parseOptions(readCommandLine());
  if (options == null) {
    console.error(usage);
    return;
  }

  const paths = makePaths(options.pathCount);
  const args = makeArguments(paths, options.separator);
  let parsedPaths = 0;

  function parseOnce(): number {
    const startedAt = performance.now();
    const result = parseSync(parser, args);
    const elapsed = performance.now() - startedAt;
    if (!result.success) {
      throw new Error(`parse failed: ${formatMessage(result.error)}`);
    }
    const parsed = result.value.paths;
    parsedPaths = parsed.length;
    if (parsed.length !== paths.length) {
      throw new Error(`parsed ${parsed.length} of ${paths.length} paths`);
    }
    for (let index = 0; index < paths.length; index += 1) {
      if (parsed[index] !== paths[index]) {
        throw new Error(
          `path ${index} came back as ${JSON.stringify(parsed[index])}`,
        );
      }
    }
    if (result.value.message !== messageText) {
      throw new Error("the --message value did not survive the parse");
    }
    return elapsed;
  }

  for (let index = 0; index < options.warmup; index += 1) {
    parseOnce();
  }

  const samples: number[] = [];
  for (let index = 0; index < options.runs; index += 1) {
    samples.push(parseOnce());
  }
  samples.sort((left, right) => left - right);

  console.log(
    JSON.stringify({
      script: "commit-paths",
      ...describeRuntime(),
      library: describeLibrary(),
      paths: paths.length,
      separator: options.separator,
      runs: options.runs,
      warmup: options.warmup,
      parsedPaths,
      medianMs: round(samples[Math.floor(samples.length / 2)]!),
      minMs: round(samples[0]!),
      maxMs: round(samples[samples.length - 1]!),
    }),
  );
}

main();
