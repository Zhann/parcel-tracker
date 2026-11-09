/**
 * The TUI's only way in or out: the swamp CLI. Reads go through
 * `swamp data query`; actions start the `@zhann/follow-parcel` or
 * `@zhann/follow-dhl-parcel` workflow or run a behavior method. Nothing here
 * reads `.swamp/` directly.
 *
 * @module
 */
import { BEHAVIOR_TYPE, type Round } from "../extensions/models/bpost_parcel.ts";
import { BEHAVIOR_TYPE as DHL_BEHAVIOR_TYPE } from "../extensions/models/dhl_parcel.ts";
import { type Carrier, carrierOf, type Status } from "../extensions/models/_lib/status.ts";
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
    `(modelType == "${BEHAVIOR_TYPE}" || modelType == "${DHL_BEHAVIOR_TYPE}") && ` +
      `specName == "status"`,
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
  /** bpost when absent. */
  carrier?: Carrier;
  code: string;
  /** Required for bpost; DHL only uses it for Parcel Germany and Netherlands. */
  postcode: string;
  label: string;
  /** DHL's service for the number; empty lets DHL find it. */
  service?: string;
}

export const CODE_PATTERN = /^[A-Za-z0-9]{8,40}$/;
export const DHL_CODE_PATTERN = /^[A-Za-z0-9-]{6,40}$/;
export const POSTCODE_PATTERN = /^[A-Za-z0-9 -]{3,10}$/;

/** The follow workflow of each carrier. */
export const FOLLOW_WORKFLOW: Record<Carrier, string> = {
  bpost: "@zhann/follow-parcel",
  dhl: "@zhann/follow-dhl-parcel",
};

/**
 * The carrier a tracking code looks like it belongs to: a 10-digit DHL
 * Express waybill or a DHL Parcel `JJD…`/`JVGL…` number is DHL's, anything
 * else bpost's. bpost codes are 13-character S10 codes or 24 digits.
 */
export function carrierFor(code: string): Carrier {
  return /^\d{10}$|^(JJD|JVGL)[A-Z0-9]{8,}$/i.test(code.trim()) ? "dhl" : "bpost";
}

/** The `swamp workflow run` arguments that follow a parcel. */
export function followArgs(repoDir: string, p: NewParcel): string[] {
  const carrier = p.carrier ?? "bpost";
  if (carrier === "dhl") {
    if (!DHL_CODE_PATTERN.test(p.code)) throw new Error("that is not a DHL tracking number");
    if (p.postcode && !POSTCODE_PATTERN.test(p.postcode)) {
      throw new Error("that is not a postal code");
    }
  } else {
    if (!CODE_PATTERN.test(p.code)) throw new Error("that is not a bpost tracking code");
    if (!POSTCODE_PATTERN.test(p.postcode)) throw new Error("that is not a postal code");
  }
  const inputs: Record<string, string> = { code: p.code, label: p.label };
  if (carrier === "bpost" || p.postcode) inputs.postcode = p.postcode;
  if (carrier === "dhl" && p.service) inputs.service = p.service;
  return [
    "workflow",
    "run",
    FOLLOW_WORKFLOW[carrier],
    "--repo-dir",
    repoDir,
    ...Object.entries(inputs).flatMap(([k, v]) => ["--input", `${k}=${v}`]),
  ];
}

/**
 * Start the carrier's follow workflow detached from the TUI, so quitting the
 * TUI or closing its pane leaves it running. Its output goes to `logs/<code>.log`.
 */
export async function startFollow(repoDir: string, p: NewParcel): Promise<string> {
  const args = followArgs(repoDir, p);
  await Deno.mkdir(`${repoDir}/logs`, { recursive: true });
  const log = `${repoDir}/logs/${p.code}.log`;
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

/** Ids of the running follow runs, of either carrier, for a tracking code. */
export async function runningFollows(run: Runner, code: string): Promise<string[]> {
  if (!CODE_PATTERN.test(code) && !DHL_CODE_PATTERN.test(code)) return [];
  const names = Object.values(FOLLOW_WORKFLOW).map((w) => `workflowName == "${w}"`).join(" || ");
  const r = await run([
    "workflow",
    "history",
    "search",
    "--json",
    "--filter",
    `(${names}) && status == "running" && inputs.code == "${code}"`,
  ]);
  if (!r.ok) throw new Error(errorOf(r.stderr));
  return (JSON.parse(r.stdout).results ?? []).map((x: { runId: string }) => x.runId);
}

/** The carrier, tracking code, postal code and label a parcel was added with. */
export async function parcelArgs(run: Runner, row: Row): Promise<NewParcel> {
  const r = await run(["behavior", "get", row.name, "--json"]);
  if (!r.ok) throw new Error(errorOf(r.stderr));
  const g = JSON.parse(r.stdout).globalArguments ?? {};
  if (carrierOf(row.status) === "dhl") {
    return {
      carrier: "dhl",
      code: g.trackingNumber,
      postcode: g.postalCode ?? "",
      label: g.label ?? "",
      service: g.service ?? "",
    };
  }
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
