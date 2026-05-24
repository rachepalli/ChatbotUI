import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const rootDir = process.cwd();
const withNext = process.argv.includes("--with-next");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
const npmRunDevArgs = isWindows ? ["/d", "/s", "/c", "npm.cmd run dev"] : ["run", "dev"];
const localEnv = loadEnvFile(path.join(rootDir, ".env.local"));
const ragPythonCommand = await resolveRagPythonCommand();

const services = [
  { name: "auth-service", dir: "services/auth-service", command: [process.execPath, "server.js"], env: { PORT: "4001", SERVICE_NAME: "auth-service" }, port: 4001 },
  { name: "thread-service", dir: "services/thread-service", command: [process.execPath, "server.js"], env: { PORT: "4002", SERVICE_NAME: "thread-service" }, port: 4002 },
  { name: "chat-service", dir: "services/chat-service", command: [process.execPath, "server.js"], env: { PORT: "4003", SERVICE_NAME: "chat-service", LLM_SERVICE_URL: process.env.LLM_SERVICE_URL || "http://localhost:4004", RAG_SERVICE_URL: process.env.RAG_SERVICE_URL || "http://localhost:4005" }, port: 4003 },
  { name: "llm-service", dir: "services/llm-service", command: [process.execPath, "server.js"], env: { PORT: "4004", SERVICE_NAME: "llm-service" }, port: 4004 },
  ragPythonCommand
    ? { name: "rag-service", dir: ".", command: [...ragPythonCommand, "services/rag-service/server.py"], env: { PORT: "4005", SERVICE_NAME: "rag-service", LLM_SERVICE_URL: process.env.LLM_SERVICE_URL || "http://localhost:4004" }, port: 4005 }
    : null,
];

if (withNext) {
  services.push({
    name: "next-app",
    dir: ".",
    command: [npmCommand, ...npmRunDevArgs],
    env: {},
    port: 3000,
    healthPath: "/",
  });
}

const children = [];
const skipped = [];
let shuttingDown = false;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) env[key] = value;
  }

  return env;
}

function buildEnv(extraEnv) {
  return Object.fromEntries(
    Object.entries({ ...localEnv, ...process.env, ...extraEnv }).filter(
      ([key, value]) => key && value !== undefined && !key.includes("\0") && !String(value).includes("\0")
    )
  );
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

function stopProcess(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve(false);
      return;
    }

    const child = isWindows
      ? spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
      : spawn("kill", ["-TERM", String(pid)], { stdio: "ignore" });

    child.on("error", () => resolve(false));
    child.on("exit", () => resolve(true));
  });
}

function processIdsOnPort(port) {
  return new Promise((resolve) => {
    if (!isWindows) {
      resolve([]);
      return;
    }

    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -and $_.OwningProcess -ne 0 } | Select-Object -ExpandProperty OwningProcess -Unique`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );

    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.on("error", () => resolve([]));
    child.on("exit", () => {
      const ids = output
        .split(/\s+/)
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);
      resolve([...new Set(ids)]);
    });
  });
}

async function freePort(port) {
  const ids = await processIdsOnPort(port);
  if (!ids.length) return false;
  console.log(`[launcher] stopping existing process(es) on port ${port}: ${ids.join(", ")}`);
  await Promise.all(ids.map(stopProcess));
  await new Promise((resolve) => setTimeout(resolve, 800));
  return true;
}

function commandWorks(command) {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    let child;
    try {
      child = spawn(cmd, [...args, "--version"], {
        stdio: "ignore",
        shell: false,
        env: buildEnv({}),
      });
    } catch {
      resolve(false);
      return;
    }
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function resolvePythonCommand() {
  const bundledPython = path.join(
    process.env.USERPROFILE || "",
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    isWindows ? "python.exe" : "bin/python"
  );
  const candidates = process.env.PYTHON
    ? [[process.env.PYTHON]]
    : isWindows
      ? [["python"], ["python3"], ["py", "-3"], [bundledPython]]
      : [["python3"], ["python"], [bundledPython]];

  for (const candidate of candidates) {
    if (await commandWorks(candidate)) return candidate;
  }
  return null;
}

async function resolveRagPythonCommand() {
  const venvPython = path.join(
    rootDir,
    "services",
    "rag-service",
    ".venv",
    isWindows ? "Scripts/python.exe" : "bin/python"
  );

  if (fs.existsSync(venvPython)) return [venvPython];
  return resolvePythonCommand();
}

function spawnProcess(proc) {
  const [cmd, ...args] = proc.command;
  const child = spawn(cmd, args, {
    cwd: path.join(rootDir, proc.dir),
    env: buildEnv(proc.env),
    shell: false,
  });

  const prefix = `[${proc.name}]`;
  child.stdout.on("data", (data) => process.stdout.write(`${prefix} ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`${prefix} ${data}`));
  child.on("error", (error) => {
    console.error(`${prefix} failed to start: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`${prefix} exited with ${reason}`);
  });

  children.push(child);
}

async function waitForHealth(proc) {
  if (!proc.port) return;

  const url = `http://localhost:${proc.port}${proc.healthPath || "/health"}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`[${proc.name}] health OK on ${proc.port}`);
        return;
      }
    } catch {
      // Keep waiting; services may still be booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.warn(`[${proc.name}] health check did not respond on ${proc.port}`);
}

function shutdown() {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const started = [];

for (const proc of services.filter(Boolean)) {
  if (withNext && proc.port) {
    await freePort(proc.port);
  }

  if (proc.port && !(await isPortAvailable(proc.port))) {
    skipped.push(proc);
    console.log(`[${proc.name}] port ${proc.port} is already in use; reusing existing process.`);
    continue;
  }

  spawnProcess(proc);
  started.push(proc);
}

await Promise.all(started.map(waitForHealth));

if (!ragPythonCommand) {
  console.warn("[rag-service] Python was not found. Install Python 3.12+ or set PYTHON to run the Agno RAG service locally.");
} else if (!ragPythonCommand[0].includes(`${path.sep}.venv${path.sep}`)) {
  console.warn("[rag-service] Using a base Python interpreter. Run `npm run setup:microservices` to install Agno into services/rag-service/.venv.");
}

if (children.length) {
  console.log(`Started ${children.length} process(es). Press Ctrl+C to stop processes started by this launcher.`);
}
if (skipped.length) {
  console.log(`Reused ${skipped.length} existing process(es): ${skipped.map((proc) => proc.name).join(", ")}.`);
}
if (!children.length && skipped.length) {
  console.log("Everything needed is already running.");
}
// Keep the launcher alive while child services run, even if a child has quiet stdio.
const keepAlive = setInterval(() => {
  const running = children.some((child) => !child.killed && child.exitCode === null && child.signalCode === null);
  if (!running && !skipped.length) {
    console.log("All started processes have exited.");
    clearInterval(keepAlive);
    process.exit(1);
  }
}, 1000);
