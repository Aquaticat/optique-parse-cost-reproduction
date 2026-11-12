// Finding 3: how a successful parse scales with the number of positional
// tokens, with a single option parser, on every @optique/core version.
//
// A parse that is linear in the token count gives a fitted exponent of 1; the
// input trace's copy of its map per recorded token is the reason it is not.
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
import { argument, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const programName = "token-scaling.ts";
const defaultCounts = [500, 1000, 2000, 4000, 8000];

const usage = [
  `Usage: ${programName} [options]`,
  "",
  "  --counts <list>   comma separated token counts to parse",
  `                    (default: ${defaultCounts.join(",")})`,
  "  --runs <count>    number of timed parses per count (default: 5)",
  "  --warmup <count>  number of untimed parses per count (default: 1)",
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
  readonly counts: readonly number[];
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

function readCounts(raw: string): readonly number[] {
  const counts = raw.split(",").map((part) => Number(part));
  for (const count of counts) {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new UsageError(`--counts needs positive whole numbers, not ${raw}`);
    }
  }
  return counts;
}

// Returns null when the caller asked for the usage text instead of a run.
function parseOptions(argv: readonly string[]): Options | null {
  let counts: readonly number[] = defaultCounts;
  let runs = 5;
  let warmup = 1;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    switch (token) {
      case "--counts": {
        const raw = argv[index + 1];
        if (raw == null) throw new UsageError(`${token} needs a value`);
        counts = readCounts(raw);
        index += 1;
        break;
      }
      case "--runs":
        runs = readNumber(argv, index + 1, token, 1);
        index += 1;
        break;
      case "--warmup":
        warmup = readNumber(argv, index + 1, token, 0);
        index += 1;
        break;
      case "--help":
        return null;
      default:
        throw new UsageError(`unknown option ${JSON.stringify(token)}`);
    }
  }
  return { counts, runs, warmup };
}
//endregion

//region Parser
// One option parser and a run of positional tokens: the smallest option set
// that still records tokens in the input trace.
const parser = object({
  name: optional(option("--name", string())),
  paths: multiple(argument(string())),
});
//endregion

//region Fitting
function medianOf(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

// Least squares slope of log(time) against log(tokens): 1 is linear, 2 is
// quadratic, and the value is only as meaningful as the spread of the points.
function fitExponent(
  points: readonly { tokens: number; ms: number }[],
): number {
  if (points.length < 2) throw new Error("a fit needs at least two counts");
  const xs = points.map((point) => Math.log(point.tokens));
  const ys = points.map((point) => Math.log(point.ms));
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < xs.length; index += 1) {
    covariance += (xs[index]! - meanX) * (ys[index]! - meanY);
    variance += (xs[index]! - meanX) ** 2;
  }
  if (variance === 0) throw new Error("a fit needs two different counts");
  return covariance / variance;
}
//endregion

function round(value: number): number {
  return Number(value.toFixed(3));
}

type Measurement = {
  readonly tokens: number;
  readonly parsedTokens: number;
  readonly runs: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly nsPerToken: number;
};

function main(): void {
  const options = parseOptions(readCommandLine());
  if (options == null) {
    console.error(usage);
    return;
  }

  const results: Measurement[] = [];
  for (const tokens of options.counts) {
    const expected = Array.from(
      { length: tokens },
      (_, index) => `p${index.toString(36)}`,
    );
    let parsedTokens = 0;

    function parseOnce(): number {
      const startedAt = performance.now();
      const result = parseSync(parser, expected);
      const elapsed = performance.now() - startedAt;
      if (!result.success) {
        throw new Error(
          `parse of ${tokens} tokens failed: ${formatMessage(result.error)}`,
        );
      }
      const parsed = result.value.paths;
      parsedTokens = parsed.length;
      if (parsed.length !== tokens) {
        throw new Error(`parsed ${parsed.length} of ${tokens} tokens`);
      }
      if (
        parsed[0] !== expected[0] || parsed[tokens - 1] !== expected[tokens - 1]
      ) {
        throw new Error(`the ${tokens} parsed tokens are not the input`);
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
    const median = medianOf(samples);
    results.push({
      tokens,
      parsedTokens,
      runs: options.runs,
      medianMs: round(median),
      minMs: round(Math.min(...samples)),
      maxMs: round(Math.max(...samples)),
      nsPerToken: round((median * 1e6) / tokens),
    });
  }

  const first = results[0]!;
  const last = results[results.length - 1]!;
  console.log(
    JSON.stringify({
      script: "token-scaling",
      ...describeRuntime(),
      library: describeLibrary(),
      counts: results.map((measurement) => measurement.tokens),
      results,
      fitExponent: round(fitExponent(
        results.map((measurement) => ({
          tokens: measurement.tokens,
          ms: measurement.medianMs,
        })),
      )),
      growthLastToFirst: round(last.medianMs / first.medianMs),
    }),
  );
}

main();
