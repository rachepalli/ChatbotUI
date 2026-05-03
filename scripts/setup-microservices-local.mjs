import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const isWindows = process.platform === "win32";
const serviceDirs = [
  "services/auth-service",
  "services/thread-service",
  "services/chat-service",
  "services/llm-service",
];

function buildEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key && value !== undefined && !key.includes("\0") && !String(value).includes("\0")
    )
  );
}

function runInstall(cwd) {
  return new Promise((resolve, reject) => {
    const command = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
    const args = isWindows
      ? ["/d", "/s", "/c", "npm.cmd install --omit=dev"]
      : ["install", "--omit=dev"];

    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      env: buildEnv(),
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Install failed in ${cwd} with exit code ${code}`));
    });
  });
}

async function main() {
  for (const dir of serviceDirs) {
    const abs = path.join(rootDir, dir);
    if (!fs.existsSync(path.join(abs, "package.json"))) {
      console.log(`Skipping ${dir}; no package.json needed.`);
      continue;
    }

    console.log(`Installing service dependencies in ${dir}...`);
    await runInstall(abs);
  }
  console.log("Local microservice setup complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
