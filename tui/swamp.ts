/**
 * The TUI's only way in or out: the swamp CLI. Reads go through
 * `swamp data query`; actions start the `@zhann/follow-parcel` workflow or run a
 * behavior method. Nothing here reads `.swamp/` directly.
 *
 * @module
 */
import { BEHAVIOR_TYPE, type Round, type Status } from "../extensions/models/bpost_parcel.ts";
import type { Row } from "./view.ts";

export interface Runner {
  (args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }>;
}

export function cliRunner(repoDir: string): Runner {
  return async (args) => {
    const out = await new Deno.Command("swamp", {
      args: [...args, "--repo-dir", repoDir],
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    }).output();
    const dec = new TextDecoder();
    return { ok: out.success, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) };
  };
}

function errorOf(stderr: string): string {
  try {
    return JSON.parse(stderr).error ?? stderr.trim();
  } catch {
    return stderr.trim().split("\n").at(-1) ?? "swamp failed";
  }
}

async function query<T>(run: Runner, predicate: string, select: string): Promise<T[]> {
  const r = await run(["data", "query", predicate, "--select", select, "--json"]);
  if (!r.ok) throw new Error(errorOf(r.stderr));
  return JSON.parse(r.stdout).results as T[];
}

const plainName = (s: string) => /^[\w.-]+$/.test(s);

/** Every parcel's latest status, newest first by last look. */
export async function listParcels(run: Runner): Promise<Row[]> {
  const rows = await query<Row>(
    run,
    `modelType == "${BEHAVIOR_TYPE}" && specName == "status"`,
    '{"name": modelName, "status": attributes}',
  );
  return rows
    .filter((r) => r.status?.itemCode)
    .sort((a, b) => b.status.checkedAt.localeCompare(a.status.checkedAt));
}

/** The parcel's most recent round, or null when it has none. */
export async function latestRound(run: Runner, name: string): Promise<Round | null> {
  if (!plainName(name)) return null;
  const rounds = await query<Round>(
    run,
    `modelName == "${name}" && specName == "round"`,
    "attributes",
  );
  return rounds.sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
}

export interface NewParcel {
  code: string;
  postcode: string;
  label: string;
}

export const CODE_PATTERN = /^[A-Za-z0-9]{8,40}$/;
export const POSTCODE_PATTERN = /^[A-Za-z0-9 -]{3,10}$/;

/**
 * Start `@zhann/follow-parcel` detached from the TUI, so quitting the TUI or closing
 * its pane leaves it running. Its output goes to `logs/<code>.log`.
 */
export async function startFollow(repoDir: string, p: NewParcel): Promise<string> {
  if (!CODE_PATTERN.test(p.code)) throw new Error("that is not a bpost tracking code");
  if (!POSTCODE_PATTERN.test(p.postcode)) throw new Error("that is not a postal code");
  await Deno.mkdir(`${repoDir}/logs`, { recursive: true });
  const log = `${repoDir}/logs/${p.code}.log`;
  const args = [
    "workflow",
    "run",
    "@zhann/follow-parcel",
    "--repo-dir",
    repoDir,
    "--input",
    `code=${p.code}`,
    "--input",
    `postcode=${p.postcode}`,
    "--input",
    `label=${p.label}`,
  ];
  const child = new Deno.Command("setsid", {
    args: [
      "-f",
      "sh",
      "-c",
      'log="$1"; shift; exec "$@" >>"$log" 2>&1',
      "sh",
      log,
      "swamp",
      ...args,
    ],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  await child.status;
  return log;
}

/** Ids of the running `@zhann/follow-parcel` runs for a tracking code. */
export async function runningFollows(run: Runner, code: string): Promise<string[]> {
  if (!CODE_PATTERN.test(code)) return [];
  const r = await run([
    "workflow",
    "history",
    "search",
    "--json",
    "--filter",
    `workflowName == "@zhann/follow-parcel" && status == "running" && inputs.code == "${code}"`,
  ]);
  if (!r.ok) throw new Error(errorOf(r.stderr));
  return (JSON.parse(r.stdout).results ?? []).map((x: { runId: string }) => x.runId);
}

/** The tracking code, postal code and label a parcel was added with. */
export async function parcelArgs(run: Runner, name: string): Promise<NewParcel> {
  const r = await run(["behavior", "get", name, "--json"]);
  if (!r.ok) throw new Error(errorOf(r.stderr));
  const g = JSON.parse(r.stdout).globalArguments ?? {};
  return { code: g.itemCode, postcode: g.postalCode, label: g.label ?? "" };
}

export async function setArchived(run: Runner, name: string, archived: boolean): Promise<void> {
  const r = await run(["behavior", "run", name, archived ? "archive" : "unarchive", "--json"]);
  if (!r.ok) throw new Error(errorOf(r.stderr));
}

/** Stop any follow of the parcel, then delete it and its data. */
export async function deleteParcel(run: Runner, row: Row): Promise<void> {
  for (const id of await runningFollows(run, row.status.itemCode)) {
    const c = await run([
      "workflow",
      "cancel",
      "--run",
      id,
      "--reason",
      "parcel deleted in the TUI",
    ]);
    if (!c.ok) throw new Error(errorOf(c.stderr));
  }
  const r = await run(["behavior", "delete", row.name, "--force", "--json"]);
  if (!r.ok) throw new Error(errorOf(r.stderr));
}

export type { Round, Status };
