/**
 * A parcel at a glance: where it is, how many stops are left and when it
 * should arrive, in Brussels time and in minutes from now.
 *
 * The `@zhann/bpost-parcel` behavior runs it after every method, so
 * `swamp behavior run bpost-<code> snapshot` looks once and prints it; the
 * stored copy is `swamp report get @zhann/parcel-report --behavior bpost-<code>`.
 *
 * @module
 */
import type { Status } from "../models/bpost_parcel.ts";
import {
  clock,
  duration,
  eventStamp,
  fromNow,
  PHASE_WORD,
  relativeDay,
} from "../models/_lib/format.ts";

/** What the report returns: markdown to read, JSON to script against. */
export interface ReportResult {
  markdown: string;
  json: Record<string, unknown>;
}

/** The slice of swamp's method report context this report reads. */
export interface ParcelReportContext {
  modelType: unknown;
  modelId: string;
  executionStatus: "succeeded" | "failed";
  errorMessage?: string;
  dataRepository: {
    getContent(
      type: unknown,
      modelId: string,
      dataName: string,
      version?: number,
    ): Promise<Uint8Array | null>;
  };
}

/** Timeline events shown; the full list is in the `status` resource. */
export const EVENTS_SHOWN = 4;

function title(s: Status): string {
  return s.label || s.sender || s.itemCode;
}

/**
 * The parcel's status as a short markdown summary and a flat JSON digest. A
 * `failure` (the method's error) is shown over the status's own error, since
 * the status may predate it.
 */
export function summarize(s: Status | null, now: Date, failure?: string): ReportResult {
  if (!s) {
    const why = failure ?? "nothing looked at it yet";
    return { markdown: `No parcel status: ${why}.\n`, json: { status: null, error: why } };
  }

  const lines: string[] = [];
  lines.push(`## ${title(s)} — ${PHASE_WORD[s.phase]}`);
  lines.push("");
  const meta = [
    s.step.text,
    s.product,
    s.weightGrams != null ? `${(s.weightGrams / 1000).toFixed(1)} kg` : null,
  ].filter(Boolean);
  lines.push(meta.join(" · "));
  lines.push("");

  const live = s.phase === "out_for_delivery";
  const error = failure ?? s.error;
  if (error) lines.push(`- **Error** ${error}`);
  if (live && s.eta) {
    const e = s.eta;
    lines.push(
      `- **ETA** ${clock(e.likely)}, ${fromNow(e.likely, now)} ` +
        `(${clock(e.earliest)}–${clock(e.latest)})`,
    );
  }
  if (live && s.round) {
    const round = s.roundName ? ` · round ${s.roundName}` : "";
    lines.push(`- **Stops** ${s.round.stops} left${round}`);
    if (s.round.distanceKm != null) {
      lines.push(`- **Van** ${s.round.distanceKm.toFixed(1)} km away`);
    }
  }
  if (live && s.eta) {
    const p = s.eta.pace;
    const basis = s.eta.basis === "prior"
      ? "a guess, too few stops seen yet"
      : `${s.eta.basis}, ${s.eta.intervals} stops`;
    lines.push(
      `- **Pace** ${duration(p.p50)} a stop (p25 ${duration(p.p25)} · ` +
        `p75 ${duration(p.p75)}) · ${basis}`,
    );
  }
  if (s.window && s.phase !== "done") {
    lines.push(`- **bpost** ${relativeDay(s.window.day, now)} ${s.window.from}–${s.window.to}`);
  }
  const follow = s.following && s.nextCheckAt
    ? `following, next look ${clock(s.nextCheckAt)}`
    : s.phase === "done"
    ? "done"
    : "not following";
  lines.push(`- **Checked** ${clock(s.checkedAt)} · ${follow}`);

  if (s.events.length) {
    lines.push("");
    lines.push("### Timeline");
    lines.push("");
    for (const e of s.events.slice(0, EVENTS_SHOWN)) {
      const where = e.location ? `${e.location} · ` : "";
      lines.push(`- ${eventStamp(e.at)} · ${where}${e.text}`);
    }
  }

  return {
    markdown: lines.join("\n") + "\n",
    json: {
      itemCode: s.itemCode,
      title: title(s),
      phase: s.phase,
      step: s.step.text,
      window: s.window,
      stopsLeft: live ? s.round?.stops ?? null : null,
      eta: live && s.eta
        ? {
          likely: s.eta.likely,
          earliest: s.eta.earliest,
          latest: s.eta.latest,
          minutesFromNow: Math.round((Date.parse(s.eta.likely) - now.getTime()) / 60_000),
        }
        : null,
      following: s.following,
      error,
      checkedAt: s.checkedAt,
    },
  };
}

/** Reads the behavior's latest `status`, null when it has none yet. */
export async function latestStatus(ctx: ParcelReportContext): Promise<Status | null> {
  const raw = await ctx.dataRepository.getContent(ctx.modelType, ctx.modelId, "status");
  return raw ? JSON.parse(new TextDecoder().decode(raw)) as Status : null;
}

/** The `@zhann/parcel-report` report, run after every method of the behavior. */
export const report = {
  name: "@zhann/parcel-report",
  description: "The parcel at a glance: step, stops left, ETA in local time and minutes, " +
    "and the latest events.",
  scope: "method" as const,
  labels: ["parcel"],
  execute: async (ctx: ParcelReportContext): Promise<ReportResult> => {
    const failure = ctx.executionStatus === "failed" ? ctx.errorMessage : undefined;
    return summarize(await latestStatus(ctx), new Date(), failure);
  },
};
