/**
 * The parcel TUI: `deno task tui` from the repo root.
 *
 * Reads every parcel's status from swamp every few seconds and redraws every
 * second. Adding a parcel starts the `@zhann/follow-parcel` workflow detached, so the
 * follow outlives the TUI; the TUI is only ever a window onto swamp's data.
 *
 * PARCEL_POSTCODE pre-fills the postal code when adding.
 *
 * @module
 */
import {
  cliRunner,
  CODE_PATTERN,
  deleteParcel,
  latestRound,
  listParcels,
  type NewParcel,
  parcelArgs,
  POSTCODE_PATTERN,
  setArchived,
  startFollow,
} from "./swamp.ts";
import { render, title, type ViewState, visibleRows } from "./view.ts";

const REFRESH_MS = 5_000;
const repoDir = Deno.env.get("SWAMP_REPO_DIR") ?? Deno.cwd();
const run = cliRunner(repoDir);
const enc = new TextEncoder();
const write = (s: string) => Deno.stdout.writeSync(enc.encode(s));

const state: ViewState = {
  rows: [],
  selected: 0,
  showArchived: false,
  round: null,
  footer: null,
  loading: true,
  lastError: null,
};

type Prompt = {
  fields: Array<{ key: keyof NewParcel; label: string; value: string }>;
  index: number;
};
let prompt: Prompt | null = null;
let confirmDelete = false;
let messageUntil = 0;

function say(message: string, ms = 4000) {
  state.footer = message;
  messageUntil = Date.now() + ms;
}

function selectedRow() {
  return visibleRows(state)[state.selected];
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  state.loading = true;
  try {
    const before = selectedRow()?.name;
    state.rows = await listParcels(run);
    const rows = visibleRows(state);
    const keep = rows.findIndex((r) => r.name === before);
    state.selected = Math.max(0, Math.min(keep >= 0 ? keep : state.selected, rows.length - 1));
    const sel = selectedRow();
    state.round = sel ? await latestRound(run, sel.name) : null;
    state.lastError = null;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    refreshing = false;
    draw();
  }
}

function draw() {
  if (state.footer && !prompt && !confirmDelete && Date.now() > messageUntil) state.footer = null;
  if (prompt) {
    const f = prompt.fields[prompt.index];
    state.footer = `${f.label}: ${f.value}█   (enter next · esc cancel)`;
  }
  const { columns, rows } = Deno.consoleSize();
  const lines = render(state, new Date(), columns, rows);
  write("\x1b[H" + lines.join("\r\n"));
}

async function act(fn: () => Promise<string | void>) {
  try {
    const done = await fn();
    if (done) say(done);
  } catch (err) {
    say(`⚠️ ${err instanceof Error ? err.message : String(err)}`, 6000);
  }
  await refresh();
}

function onPromptKey(key: string) {
  const p = prompt!;
  const f = p.fields[p.index];
  if (key === "\x1b") {
    prompt = null;
    say("not added");
  } else if (key === "\r") {
    if (f.key === "code" && !CODE_PATTERN.test(f.value.trim())) {
      return say("that is not a bpost tracking code");
    }
    if (f.key === "postcode" && !POSTCODE_PATTERN.test(f.value.trim())) {
      return say("that is not a postal code");
    }
    if (p.index < p.fields.length - 1) {
      p.index++;
    } else {
      const values = Object.fromEntries(
        p.fields.map((x) => [x.key, x.value.trim()]),
      ) as unknown as NewParcel;
      prompt = null;
      say(`starting to follow ${values.label || values.code}…`, 10_000);
      act(async () => {
        const log = await startFollow(repoDir, values);
        return `following ${values.label || values.code}; log in ${log.replace(repoDir + "/", "")}`;
      });
    }
  } else if (key === "\x7f" || key === "\b") {
    f.value = f.value.slice(0, -1);
  } else if (key.length === 1 && key >= " ") {
    f.value += key;
  } else if (key.length > 1 && !key.startsWith("\x1b")) {
    f.value += key.replace(/[\r\n]/g, ""); // a paste
  }
  draw();
}

function onKey(key: string): boolean {
  if (prompt) {
    onPromptKey(key);
    return true;
  }
  const rows = visibleRows(state);
  const row = selectedRow();

  if (confirmDelete) {
    confirmDelete = false;
    if (key === "y" && row) {
      say(`deleting ${title(row.status)}…`, 10_000);
      act(async () => {
        await deleteParcel(run, row);
        return `deleted ${title(row.status)}`;
      });
    } else say("kept");
    draw();
    return true;
  }

  switch (key) {
    case "q":
    case "\x03":
      return false;
    case "\x1b[A":
    case "k":
      state.selected = Math.max(0, state.selected - 1);
      state.round = null;
      refresh();
      break;
    case "\x1b[B":
    case "j":
      state.selected = Math.min(rows.length - 1, state.selected + 1);
      state.round = null;
      refresh();
      break;
    case "a":
      prompt = {
        index: 0,
        fields: [
          { key: "code", label: "Tracking code", value: "" },
          { key: "postcode", label: "Postal code", value: Deno.env.get("PARCEL_POSTCODE") ?? "" },
          { key: "label", label: "Label (optional)", value: "" },
        ],
      };
      break;
    case "r":
      if (!row) break;
      if (row.status.following) {
        say("already following; it looks again on its own");
        break;
      }
      say(`following ${title(row.status)} again…`, 10_000);
      act(async () => {
        await startFollow(repoDir, await parcelArgs(run, row.name));
        return `following ${title(row.status)}`;
      });
      break;
    case "x":
      if (!row) break;
      if (row.status.following) {
        say("still following it; archive once it is delivered, or d to delete");
        break;
      }
      act(async () => {
        await setArchived(run, row.name, !row.status.archived);
        return row.status.archived ? "back in the list" : "archived; h shows archived parcels";
      });
      break;
    case "h":
      state.showArchived = !state.showArchived;
      state.selected = 0;
      say(state.showArchived ? "showing archived parcels" : "hiding archived parcels");
      refresh();
      break;
    case "d":
      if (!row) break;
      confirmDelete = true;
      state.footer = `Delete ${title(row.status)} and all its data${
        row.status.following ? ", stopping its follow" : ""
      }? y/n`;
      messageUntil = Number.MAX_SAFE_INTEGER;
      break;
  }
  draw();
  return true;
}

async function main() {
  if (!Deno.stdin.isTerminal()) {
    console.error("parcel TUI needs a terminal");
    Deno.exit(1);
  }
  Deno.stdin.setRaw(true);
  write("\x1b[?1049h\x1b[?25l"); // alternate screen, hide cursor
  const restore = () => {
    write("\x1b[?25h\x1b[?1049l");
    try {
      Deno.stdin.setRaw(false);
    } catch { /* already gone */ }
  };
  Deno.addSignalListener("SIGWINCH", draw);
  Deno.addSignalListener("SIGTERM", () => {
    restore();
    Deno.exit(0);
  });

  const ticker = setInterval(draw, 1000);
  const poller = setInterval(refresh, REFRESH_MS);
  refresh();
  draw();

  const buf = new Uint8Array(1024);
  const dec = new TextDecoder();
  try {
    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n == null) break;
      const chunk = dec.decode(buf.subarray(0, n));
      // Arrow keys arrive as one escape sequence; anything else is a key or a paste.
      // deno-lint-ignore no-control-regex
      const keys = chunk.match(/\x1b\[[A-D]|[\s\S]/g) ?? [];
      const pasted = !prompt || keys.length < 4 ? keys : [chunk];
      let keepGoing = true;
      for (const k of pasted) {
        if (!onKey(k)) {
          keepGoing = false;
          break;
        }
      }
      if (!keepGoing) break;
    }
  } finally {
    clearInterval(ticker);
    clearInterval(poller);
    restore();
  }
  Deno.exit(0);
}

if (import.meta.main) main();
