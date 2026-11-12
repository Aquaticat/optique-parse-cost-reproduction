// Turns a reproducer's JSON output into a pass or a fail, so that a continuous
// integration run is red exactly when the behaviour reproduces.
//
//   node expect.ts exponent-below <limit> <file>
//     <file> holds the one JSON line token-scaling.ts printed.  Passes when its
//     fitted exponent is below <limit>; a linear parse gives about 1.
//
//   node expect.ts ratio-below <limit> <baseline file> <candidate file>
//     Each file holds one JSON line per run of commit-paths.ts.  Passes when the
//     median of the candidate's medians, divided by the median of the
//     baseline's, is below <limit>.

import { readFileSync } from "node:fs";

function readLines(path: string): readonly Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function numberField(record: Record<string, unknown>, name: string): number {
  const value = record[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`the record has no numeric ${name}`);
  }
  return value;
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) throw new Error("no runs were recorded");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function readLimit(raw: string | undefined): number {
  const limit = Number(raw);
  if (raw == null || !Number.isFinite(limit)) {
    throw new Error("the limit must be a number");
  }
  return limit;
}

const [kind, rawLimit, firstPath, secondPath] = process.argv.slice(2);
const limit = readLimit(rawLimit);

if (kind === "exponent-below" && firstPath != null) {
  const [record] = readLines(firstPath);
  if (record == null) throw new Error(`${firstPath} holds no JSON line`);
  const exponent = numberField(record, "fitExponent");
  console.log(
    `Fitted exponent of parse time against token count: ${exponent} ` +
      `(1 is linear, 2 is quadratic; expected below ${limit}).`,
  );
  if (!(exponent < limit)) process.exitCode = 1;
} else if (kind === "ratio-below" && firstPath != null && secondPath != null) {
  const baseline = medianOf(
    readLines(firstPath).map((record) => numberField(record, "medianMs")),
  );
  const candidate = medianOf(
    readLines(secondPath).map((record) => numberField(record, "medianMs")),
  );
  const ratio = candidate / baseline;
  console.log(
    `Baseline median ${baseline.toFixed(1)} ms, candidate median ` +
      `${candidate.toFixed(1)} ms, ratio ${ratio.toFixed(2)} ` +
      `(expected below ${limit}).`,
  );
  if (!(ratio < limit)) process.exitCode = 1;
} else {
  throw new Error(
    "usage: expect.ts exponent-below <limit> <file> | " +
      "expect.ts ratio-below <limit> <baseline file> <candidate file>",
  );
}
