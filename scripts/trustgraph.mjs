#!/usr/bin/env node
/**
 * TRUSTGRAPH launcher — one command for the whole platform, on Windows,
 * macOS and Linux. No dependencies beyond Node 20+ and Python 3.11+.
 *
 *   node scripts/trustgraph.mjs setup    one-time: installs, creates DBs, seeds demo data
 *   node scripts/trustgraph.mjs dev      starts all four services, prefixed logs, Ctrl+C stops all
 *   node scripts/trustgraph.mjs status   health of the four services
 *   node scripts/trustgraph.mjs test     every test suite in the repo
 *
 * (Also available as `npm run setup|dev|status|test` from the repo root.)
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const DEMO_TENANT = "11111111-2222-3333-4444-555555555555";
const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const C = { m1: color(35), m2: color(36), m3: color(33), ui: color(32), dim: color(2), err: color(31), ok: color(32) };

const dir = (...p) => path.join(ROOT, ...p);
const venvPython = (mod) => (WIN ? dir(mod, ".venv", "Scripts", "python.exe") : dir(mod, ".venv", "bin", "python"));
const npmCmd = WIN ? "npm.cmd" : "npm";

const SERVICES = [
  { key: "m1", name: "Module 1 · Sentinel DRP", port: 3000, cwd: "module1", health: "/api/health",
    cmd: () => [npmCmd, ["run", "dev", "--", "-p", "3000"]], needs: () => existsSync(dir("module1", "node_modules")) },
  { key: "m3", name: "Module 3 · Entity & Evidence", port: 8001, cwd: "module3", health: "/healthz",
    cmd: () => [venvPython("module3"), ["-m", "uvicorn", "module3.main:app", "--port", "8001"]], needs: () => existsSync(venvPython("module3")) },
  { key: "m2", name: "Module 2 · Risk engine + AI analyst", port: 8000, cwd: "backend", health: "/readyz",
    cmd: () => [venvPython("backend"), ["-m", "uvicorn", "app.main:app", "--port", "8000"]], needs: () => existsSync(venvPython("backend")) },
  { key: "ui", name: "Console", port: 5173, cwd: "frontend", health: "/",
    cmd: () => [npmCmd, ["run", "dev", "--", "--port", "5173", "--strictPort"]], needs: () => existsSync(dir("frontend", "node_modules")) },
];

function run(cmd, args, cwd, { allowFail = false } = {}) {
  console.log(C.dim(`$ (${path.relative(ROOT, cwd) || "."}) ${path.basename(cmd)} ${args.join(" ")}`));
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: WIN && cmd.endsWith(".cmd") });
  if (r.status !== 0 && !allowFail) {
    console.error(C.err(`✘ failed: ${cmd} ${args.join(" ")} (exit ${r.status ?? r.error?.message})`));
    process.exit(1);
  }
  return r.status === 0;
}

function findPython() {
  for (const [cmd, pre] of WIN ? [["py", ["-3"]], ["python", []]] : [["python3", []], ["python", []]]) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; print(sys.version_info >= (3, 11))"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === "True") return [cmd, pre];
  }
  console.error(C.err("✘ Python 3.11+ not found on PATH (tried py/python3/python)."));
  process.exit(1);
}

function setup() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    console.error(C.err(`✘ Node 20+ required (found ${process.versions.node}).`));
    process.exit(1);
  }
  if (/[&%^!]/.test(ROOT)) {
    console.error(C.err(`✘ The project path contains a character npm cannot handle on Windows (& % ^ !):\n  ${ROOT}\n  Move the folder (e.g. C:\\dev\\trustgraph) and run setup again.`));
    process.exit(1);
  }
  const [py, pre] = findPython();

  for (const [example, target] of [["module1/.env.example", "module1/.env"], ["backend/.env.example", "backend/.env"]]) {
    if (existsSync(dir(example)) && !existsSync(dir(target))) {
      copyFileSync(dir(example), dir(target));
      console.log(C.ok(`✔ created ${target} from ${example} (add GROQ_API_KEY there to enable AI explanations)`));
    }
  }

  // Module 1 — seed only on first run: its seed resets the sample scans.
  const m1FirstRun = !existsSync(dir("module1", "prisma", "dev.db"));
  run(npmCmd, ["install"], dir("module1"));
  if (m1FirstRun) run(npmCmd, ["run", "setup"], dir("module1"));
  else run(npmCmd, ["run", "db:push"], dir("module1"));

  for (const mod of ["module3", "backend"]) {
    if (!existsSync(venvPython(mod))) run(py, [...pre, "-m", "venv", ".venv"], dir(mod));
    run(venvPython(mod), ["-m", "pip", "install", "--quiet", "-e", ".[dev]"], dir(mod));
    run(venvPython(mod), ["-m", "alembic", "upgrade", "head"], dir(mod));
  }
  run(venvPython("module3"), ["-m", "module3.seed", DEMO_TENANT], dir("module3")); // idempotent

  run(npmCmd, ["install"], dir("frontend"));
  console.log(C.ok("\n✔ Setup complete. Start everything with:  npm run dev"));
}

async function probe(svc, timeoutMs = 1500) {
  try {
    const res = await fetch(`http://127.0.0.1:${svc.port}${svc.health}`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function status() {
  let up = 0;
  for (const svc of SERVICES) {
    const ok = await probe(svc);
    up += ok ? 1 : 0;
    console.log(`${ok ? C.ok("● up  ") : C.err("○ down")}  ${svc.name.padEnd(38)} http://localhost:${svc.port}${svc.health}`);
  }
  return up;
}

function prefixLines(stream, label) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) process.stdout.write(`${label} ${line}\n`);
  });
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

async function dev() {
  const missing = SERVICES.filter((s) => !s.needs());
  if (missing.length) {
    console.error(C.err(`✘ Not set up yet: ${missing.map((s) => s.cwd).join(", ")}. Run:  npm run setup`));
    process.exit(1);
  }
  const busy = [];
  for (const s of SERVICES) if (await probe(s, 600)) busy.push(s);
  if (busy.length) {
    console.error(C.err(`✘ Already running on ${busy.map((s) => s.port).join(", ")}. Stop those first (or use npm run status).`));
    process.exit(1);
  }
  if (!existsSync(dir("backend", ".env"))) {
    console.log(C.dim("note: backend/.env missing — Module 2 falls back to its defaults (copy backend/.env.example)."));
  }

  let stopping = false;
  const children = SERVICES.map((svc) => {
    const [cmd, args] = svc.cmd();
    const child = spawn(cmd, args, {
      cwd: dir(svc.cwd),
      env: { ...process.env, FORCE_COLOR: "0", PYTHONUNBUFFERED: "1" },
      shell: WIN && cmd.endsWith(".cmd"),
      detached: !WIN,
    });
    const label = C[svc.key](`[${svc.key}]`);
    prefixLines(child.stdout, label);
    prefixLines(child.stderr, label);
    child.on("exit", (code) => {
      if (!stopping) console.log(C.err(`${label} ${svc.name} exited (code ${code}). Other services keep running; Ctrl+C to stop all.`));
    });
    return child;
  });

  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log(C.dim("\nStopping all services…"));
    children.forEach(killTree);
    setTimeout(() => process.exit(0), 800);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Wait until every service answers its health check (Next's first compile is slow).
  const deadline = Date.now() + 120_000;
  const pending = new Set(SERVICES);
  while (pending.size && Date.now() < deadline && !stopping) {
    for (const svc of [...pending]) if (await probe(svc)) pending.delete(svc);
    if (pending.size) await new Promise((r) => setTimeout(r, 1500));
  }
  if (stopping) return;
  console.log("");
  await status();
  console.log(
    pending.size
      ? C.err(`\n${pending.size} service(s) not healthy after 120 s — see their [prefixed] logs above. The console shows a down service instead of fake data.`)
      : C.ok(`\n✔ TRUSTGRAPH is running → open http://localhost:5173   (Ctrl+C stops everything)`),
  );
}

function test() {
  const results = [];
  const step = (name, cmd, args, cwd) => results.push([name, run(cmd, args, dir(cwd), { allowFail: true })]);
  step("Module 2 + 4 backend (pytest)", venvPython("backend"), ["-m", "pytest", "-q", "-p", "no:warnings"], "backend");
  step("Module 3 (pytest)", venvPython("module3"), ["-m", "pytest", "-q", "-p", "no:warnings"], "module3");
  step("Module 1 typecheck", npmCmd, ["run", "typecheck"], "module1");
  step("Module 1 engine + SSRF checks", npmCmd, ["run", "test:engine"], "module1");
  step("Module 1 brand-input checks", npmCmd, ["run", "test:brands"], "module1");
  step("Console typecheck", npmCmd, ["run", "typecheck"], "frontend");
  step("Console tests (vitest)", npmCmd, ["test"], "frontend");
  console.log("\nSummary");
  for (const [name, ok] of results) console.log(`${ok ? C.ok("✔") : C.err("✘")} ${name}`);
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}

const command = process.argv[2] ?? "dev";
const commands = { setup, dev, status: async () => process.exit((await status()) === SERVICES.length ? 0 : 1), test };
if (!commands[command]) {
  console.error(`Usage: node scripts/trustgraph.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}
await commands[command]();
