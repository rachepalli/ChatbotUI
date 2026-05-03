import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const withNext = process.argv.includes("--with-next");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
const npmRunDevArgs = isWindows ? ["/d", "/s", "/c", "npm.cmd run dev"] : ["run", "dev"];
const localEnv = loadEnvFile(path.join(rootDir, ".env.local"));

const services = [
  { name: "auth-service", dir: "services/auth-service", command: [process.execPath, "server.js"], env: { PORT: "4001", SERVICE_NAME: "auth-service" } },
  { name: "thread-service", dir: "services/thread-service", command: [process.execPath, "server.js"], env: { PORT: "4002", SERVICE_NAME: "thread-service" } },
  { name: "chat-service", dir: "services/chat-service", command: [process.execPath, "server.js"], env: { PORT: "4003", SERVICE_NAME: "chat-service", LLM_SERVICE_URL: process.env.LLM_SERVICE_URL || "http://localhost:4004" } },
  { name: "llm-service", dir: "services/llm-service", command: [process.execPath, "server.js"], env: { PORT: "4004", SERVICE_NAME: "llm-service" } },
];

if (withNext) {
  services.push({
    name: "next-app",
    dir: ".",
    command: [npmCommand, ...npmRunDevArgs],
    env: {},
  });
}

const children = [];

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
  child.on("exit", (code) => {
    console.log(`${prefix} exited with code ${code}`);
  });

  children.push(child);
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

for (const proc of services) {
  spawnProcess(proc);
}

console.log("Local microservices started. Press Ctrl+C to stop.");
