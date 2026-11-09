/**
 * The published packages, read the way swamp reads them: each
 * `packages/<name>/manifest.yaml` and the `model` and `report` its entry files
 * export.
 */
import { assert, assertEquals } from "jsr:@std/assert@1.0.13";
import { parse } from "jsr:@std/yaml@1.3.0";
import { CARRIERS } from "../extensions/models/_lib/status.ts";

const ROOT = new URL("../", import.meta.url);

interface Manifest {
  name: string;
  version: string;
  models?: string[];
  reports?: string[];
  workflows?: string[];
  additionalFiles?: string[];
  dependencies?: string[];
}

/** What a behavior's `model` export says about itself. */
interface Behavior {
  file: string;
  type: string;
  version: string;
  /** The reports it runs after every method. */
  reports: string[];
  /** The `toVersion` of each upgrade, in order. */
  upgrades: string[];
}

/** The parts of a workflow file these tests read. */
interface Workflow {
  name: string;
  jobs: { steps: { task: { behaviorType?: string } }[] }[];
}

interface Package {
  dir: string;
  manifest: Manifest;
  models: Behavior[];
  /** The names of the reports it ships. */
  reports: string[];
}

async function loadPackages(): Promise<Package[]> {
  const packages: Package[] = [];
  for await (const entry of Deno.readDir(new URL("packages/", ROOT))) {
    if (!entry.isDirectory) continue;
    const dir = `packages/${entry.name}`;
    const manifest = parse(
      await Deno.readTextFile(new URL(`${dir}/manifest.yaml`, ROOT)),
    ) as Manifest;
    const models: Behavior[] = [];
    for (const file of manifest.models ?? []) {
      const { model } = await import(new URL(`extensions/models/${file}`, ROOT).href);
      models.push({
        file,
        type: model.type,
        version: model.version,
        reports: model.reports ?? [],
        upgrades: (model.upgrades ?? []).map((u: { toVersion: string }) => u.toVersion),
      });
    }
    const reports = [];
    for (const file of manifest.reports ?? []) {
      const { report } = await import(new URL(`extensions/reports/${file}`, ROOT).href);
      reports.push(report.name as string);
    }
    packages.push({ dir, manifest, models, reports });
  }
  return packages.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

const packages = await loadPackages();

/** Every local module `entry` imports, directly or not, as paths from the repo root. */
async function localImports(entry: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await Deno.readTextFile(new URL(file, ROOT));
    for (
      const [, spec] of source.matchAll(/^(?:import|export)[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gms)
    ) {
      todo.push(new URL(spec, new URL(file, ROOT)).href.slice(ROOT.href.length));
    }
  }
  return seen;
}

Deno.test("the three packages are published from packages/", () => {
  assertEquals(packages.map((p) => p.manifest.name), [
    "@zhann/bpost-parcel",
    "@zhann/dhl-parcel",
    "@zhann/parcel-report",
  ]);
});

Deno.test("a report name ships in exactly one package", () => {
  const owners = new Map<string, string[]>();
  for (const p of packages) {
    for (const r of p.reports) owners.set(r, [...owners.get(r) ?? [], p.manifest.name]);
  }
  for (const [report, names] of owners) assertEquals(names.length, 1, `${report}: ${names}`);
});

Deno.test("every report a behavior runs ships in its package or a dependency", () => {
  const byName = new Map(packages.map((p) => [p.manifest.name, p]));
  for (const p of packages) {
    const reachable = new Set(p.reports);
    for (const dep of p.manifest.dependencies ?? []) {
      const d = byName.get(dep);
      assert(d, `${p.manifest.name} depends on ${dep}, which is not in packages/`);
      for (const r of d.reports) reachable.add(r);
    }
    for (const m of p.models) {
      for (const r of m.reports) {
        assert(reachable.has(r), `${m.type} runs ${r}, which ${p.manifest.name} does not bring`);
      }
    }
  }
});

Deno.test("a behavior's version is its package's, and its upgrades end there", () => {
  for (const p of packages) {
    for (const m of p.models) {
      assertEquals(m.version, p.manifest.version, `${m.type} model.version`);
      if (m.upgrades.length) assertEquals(m.upgrades.at(-1), m.version, `${m.type} upgrades`);
    }
  }
});

Deno.test("each package ships a README and LICENSE from beside its manifest", async () => {
  for (const p of packages) {
    assertEquals(p.manifest.additionalFiles, ["README.md", "LICENSE"], p.manifest.name);
    const readme = await Deno.readTextFile(new URL(`${p.dir}/README.md`, ROOT));
    assert(readme.startsWith(`# ${p.manifest.name}\n`), `${p.dir}/README.md names its package`);
    const license = await Deno.readTextFile(new URL(`${p.dir}/LICENSE`, ROOT));
    assert(license.startsWith("MIT License"), `${p.dir}/LICENSE is the MIT license`);
  }
});

Deno.test("a workflow runs only its own package's behaviors, under @zhann/", async () => {
  for (const p of packages) {
    const types = new Set(p.models.map((m) => m.type));
    for (const file of p.manifest.workflows ?? []) {
      const wf = parse(await Deno.readTextFile(new URL(`workflows/${file}`, ROOT))) as Workflow;
      assert(wf.name.startsWith("@zhann/"), `${file}: ${wf.name}`);
      for (const step of wf.jobs.flatMap((j) => j.steps)) {
        const t = step.task.behaviorType;
        if (t) assert(types.has(t), `${file} runs ${t}, which ${p.manifest.name} does not ship`);
      }
    }
  }
});

Deno.test("a carrier package's code imports nothing named for another carrier", async () => {
  for (const p of packages) {
    for (const m of p.models) {
      const own = m.type.replace("@zhann/", "").replace("-parcel", "");
      const others = CARRIERS.filter((c) => c !== own);
      for (const file of await localImports(`extensions/models/${m.file}`)) {
        const base = file.split("/").at(-1)!;
        for (const c of others) {
          assert(!base.startsWith(c), `${p.manifest.name} ships ${file} through ${m.file}`);
        }
      }
    }
  }
});

Deno.test("a carrier package ships only its own behavior, named as the package", () => {
  for (const p of packages) {
    for (const m of p.models) assertEquals(m.type, p.manifest.name);
  }
});
