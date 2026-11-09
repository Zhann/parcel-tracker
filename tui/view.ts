/**
 * Rendering, kept pure: state and a clock in, lines of styled text out.
 *
 * A glyph names each state, a word follows it, and the colour agrees but never
 * carries it alone. The tints are picked for a dark terminal, and none of them
 * is orange.
 *
 * @module
 */
import type { Round } from "../extensions/models/bpost_parcel.ts";
import { CARRIER_WORD, carrierOf, type Status } from "../extensions/models/_lib/status.ts";
import {
  clock,
  duration,
  eventStamp,
  fromNow,
  PHASE_WORD,
  windowText,
} from "../extensions/models/_lib/format.ts";
import { DHL_CREDIT } from "../extensions/reports/parcel_report.ts";

export { clock, duration };

export interface Row {
  name: string;
  status: Status;
}

export interface ViewState {
  rows: Row[];
  selected: number;
  showArchived: boolean;
  round: Round | null;
  /** Footer: a prompt, a message, or null for the key help. */
  footer: string | null;
  loading: boolean;
  lastError: string | null;
}

// ── styles ─────────────────────────────────────────────────────────────────

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${n >> 16};${(n >> 8) & 255};${n & 255}m`;
};

export const S = {
  healthy: rgb("#45D6B0"),
  degraded: rgb("#ECCF5C"),
  broken: rgb("#FB5570"),
  recovering: rgb("#7CB8F7"),
  dim: rgb("#949AA3"),
  bold: "\x1b[1m",
  reverse: "\x1b[7m",
  reset: "\x1b[0m",
} as const;

export type Seg = [text: string, style?: string];
export type Line = Seg[];

// ── text width ─────────────────────────────────────────────────────────────

/** Terminal columns a code point takes: 0, 1 or 2. */
function cpWidth(cp: number): number {
  if (cp === 0xfe0f || cp === 0x200d || (cp >= 0x300 && cp <= 0x36f)) return 0;
  if (
    (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xff00 && cp <= 0xff60)
  ) {
    // Symbols in the 2600 block render narrow unless VS16 follows; the ones
    // used here (✅ ⚠️ ❌) are wide, ⚠️ because it always carries VS16.
    return 2;
  }
  return 1;
}

export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += cpWidth(ch.codePointAt(0)!);
  return w;
}

/** Cut to at most `width` columns, with an ellipsis when cut. */
export function truncate(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = cpWidth(ch.codePointAt(0)!);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

export function lineWidth(line: Line): number {
  return line.reduce((w, [t]) => w + displayWidth(t), 0);
}

/** Truncate or pad a line to exactly `width` columns. */
export function fitLine(line: Line, width: number): Line {
  const out: Line = [];
  let left = width;
  for (const [text, style] of line) {
    if (left <= 0) break;
    const w = displayWidth(text);
    if (w <= left) {
      out.push([text, style]);
      left -= w;
    } else {
      out.push([truncate(text, left), style]);
      left -= displayWidth(truncate(text, left));
      break;
    }
  }
  if (left > 0) out.push([" ".repeat(left)]);
  return out;
}

export function toAnsi(line: Line): string {
  return line.map(([t, s]) => (s ? `${s}${t}${S.reset}` : t)).join("");
}

export function plain(line: Line): string {
  return line.map(([t]) => t).join("");
}

// ── parcel state ───────────────────────────────────────────────────────────

/** A follow whose next look is this late has stopped without saying so. */
export const STALE_AFTER_MS = 3 * 60_000;

export function isStale(s: Status, now: Date): boolean {
  return s.following && s.nextCheckAt != null &&
    now.getTime() - Date.parse(s.nextCheckAt) > STALE_AFTER_MS;
}

/** The list's state cell: glyph, word, colour. */
export function stateCell(s: Status, now: Date): Seg {
  if (s.error) return ["❌ error", S.broken];
  if (isStale(s, now)) return ["⚠️ stale", S.degraded];
  if (s.phase === "done") return ["✅ delivered", S.healthy];
  if (s.round) return [`● ${s.round.stops} stops`, S.recovering];
  if (s.phase === "out_for_delivery") return ["› on its way", S.recovering];
  if (s.phase === "at_pickup_point") return ["▪ pick it up", S.degraded];
  return [`· ${PHASE_WORD[s.phase]}`, S.dim];
}

export function title(s: Status): string {
  return s.label || s.sender || s.itemCode;
}

export function visibleRows(state: ViewState): Row[] {
  return state.rows.filter((r) => state.showArchived || !r.status.archived);
}

// ── panes ──────────────────────────────────────────────────────────────────

function listPane(state: ViewState, now: Date, width: number): Line[] {
  const rows = visibleRows(state);
  if (rows.length === 0) {
    return [[[" No parcels yet. Press a to add one.", S.dim]]];
  }
  return rows.map((r, i) => {
    const mark = i === state.selected ? "▸ " : "  ";
    const cell = stateCell(r.status, now);
    const nameWidth = Math.max(4, width - 2 - displayWidth(cell[0]) - 2);
    const name = truncate(title(r.status), nameWidth);
    const line: Line = [
      [mark, i === state.selected ? S.bold : undefined],
      [
        name.padEnd(nameWidth + name.length - displayWidth(name)),
        r.status.archived ? S.dim : undefined,
      ],
      ["  "],
      cell,
    ];
    return line;
  });
}

const SPARK = "▁▂▃▄▅▆▇█";

/** Stops left over time, newest on the right, scaled to the round's start. */
export function sparkline(stops: number[], width: number): string {
  if (stops.length === 0 || width <= 0) return "";
  const step = Math.max(1, Math.ceil(stops.length / width));
  const picked: number[] = [];
  for (let i = 0; i < stops.length; i += step) {
    picked.push(stops[Math.min(i + step - 1, stops.length - 1)]);
  }
  const max = Math.max(...picked, 1);
  return picked.map((v) => SPARK[Math.min(7, Math.round((v / max) * 7))]).join("");
}

function field(label: string, value: Line): Line {
  return [[label.padEnd(9), S.dim], ...value];
}

/** How long the van's distance has not changed, from the round's samples. */
function vanStill(round: Round | null): number | null {
  const samples = round?.samples ?? [];
  const last = samples.at(-1);
  if (!last || last.distanceKm == null) return null;
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].distanceKm === last.distanceKm) i--;
  return (Date.parse(last.at) - Date.parse(samples[i].at)) / 1000;
}

function detailPane(row: Row | undefined, round: Round | null, now: Date, width: number): Line[] {
  if (!row) return [];
  const s = row.status;
  const out: Line[] = [];
  const meta = [s.product, s.weightGrams != null ? `${(s.weightGrams / 1000).toFixed(1)} kg` : null]
    .filter(Boolean).join(" · ");
  out.push([[title(s), S.bold], ["  "], [meta, S.dim]]);
  out.push([]);

  out.push(field("Step", [[PHASE_WORD[s.phase]], [s.step.text ? ` — ${s.step.text}` : "", S.dim]]));
  if (s.window && s.phase !== "done") {
    out.push(field(CARRIER_WORD[carrierOf(s)], [[windowText(s.window, now)]]));
  }
  if (s.roundName) out.push(field("Round", [[s.roundName]]));

  if (s.round) {
    const today = round?.samples.map((x) => x.stops) ?? [];
    const head = `${s.round.stops} left`;
    out.push(
      field("Stops", [[head, S.bold], ["   "], [
        sparkline(today, Math.max(0, width - 9 - head.length - 3)),
        S.recovering,
      ]]),
    );
  }

  const eta = s.eta;
  if (eta && s.phase === "out_for_delivery") {
    const p = eta.pace;
    const basis = eta.basis === "prior"
      ? "guess, too few stops seen"
      : `${eta.basis}, ${eta.intervals} stops`;
    out.push(
      field("Pace", [[`${duration(p.p50)} a stop`], [
        ` (p25 ${duration(p.p25)} · p75 ${duration(p.p75)}) · ${basis}`,
        S.dim,
      ]]),
    );
    const when = fromNow(eta.likely, now);
    out.push(
      field("ETA", [[`${clock(eta.earliest)}–${clock(eta.latest)}`, S.bold], [
        ` · likely ${clock(eta.likely)} · ${when}`,
      ]]),
    );
  }

  if (s.round?.distanceKm != null) {
    const still = vanStill(round);
    const moving = still != null && still >= 120 ? `stopped ${duration(still)}` : "moving";
    out.push(field("Van", [[`${s.round.distanceKm.toFixed(1)} km away`], [` · ${moving}`, S.dim]]));
  }

  const ago = duration((now.getTime() - Date.parse(s.checkedAt)) / 1000);
  let follow: Seg;
  if (s.error) follow = [`❌ error: ${s.error}`, S.broken];
  else if (isStale(s, now)) {
    follow = ["⚠️ stale: the follow stopped answering; r restarts it", S.degraded];
  } else if (s.following && s.nextCheckAt) {
    follow = [
      `following · next in ${duration((Date.parse(s.nextCheckAt) - now.getTime()) / 1000)}`,
      S.dim,
    ];
  } else follow = [s.phase === "done" ? "done" : "not following; r follows it", S.dim];
  out.push(field("Checked", [[`${ago} ago`], [" · "], follow]));

  out.push([]);
  out.push([["Timeline", S.dim]]);
  for (const e of s.events) {
    out.push([
      [`  ${eventStamp(e.at)}  `, S.dim],
      [(e.location ?? "").padEnd(18).slice(0, 18) + "  "],
      [e.text],
    ]);
  }
  if (carrierOf(s) === "dhl") {
    out.push([]);
    out.push([[DHL_CREDIT, S.dim]]);
  }
  return out;
}

export const KEYS = "↑↓ select  a add  r follow  x archive  h archived  d delete  q quit";

/** The whole screen, exactly `height` lines of `width` columns. */
export function render(state: ViewState, now: Date, width: number, height: number): string[] {
  const rows = visibleRows(state);
  const selected = rows[state.selected];
  const header: Line = [
    [" Parcels", S.bold],
    [state.loading ? "  ·" : "   ", S.dim],
  ];
  const right = `${clock(now.toISOString())} `;
  const top = fitLine([...fitLine(header, width - right.length), [right, S.dim]], width);

  const footerText = state.footer ?? (state.lastError ? `⚠️ ${state.lastError}` : KEYS);
  const footer = fitLine([[
    ` ${footerText}`,
    state.footer ? S.bold : state.lastError ? S.degraded : S.dim,
  ]], width);

  const bodyHeight = Math.max(0, height - 2);
  const body: Line[] = [];
  if (width >= 72) {
    const leftWidth = Math.min(36, Math.floor(width * 0.38));
    const rightWidth = width - leftWidth - 3;
    const left = listPane(state, now, leftWidth);
    const detail = detailPane(selected, state.round, now, rightWidth);
    for (let i = 0; i < bodyHeight; i++) {
      body.push([
        ...fitLine(left[i] ?? [], leftWidth),
        [" │ ", S.dim],
        ...fitLine(detail[i] ?? [], rightWidth),
      ]);
    }
  } else {
    const stacked = [
      ...listPane(state, now, width),
      [["─".repeat(width), S.dim]] as Line,
      ...detailPane(selected, state.round, now, width),
    ];
    for (let i = 0; i < bodyHeight; i++) body.push(fitLine(stacked[i] ?? [], width));
  }
  return [top, ...body, footer].map(toAnsi);
}
