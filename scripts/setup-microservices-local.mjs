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
  "services/rag-service",
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

function commandWorks(command) {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd, [...args, "--version"], {
      stdio: "ignore",
      shell: false,
      env: buildEnv(),
    });

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

function runPipInstall(cwd, pythonCommand) {
  return new Promise((resolve, reject) => {
    const [cmd, ...baseArgs] = pythonCommand;
    const args = [...baseArgs, "-m", "pip", "install", "-r", "requirements.txt"];

    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      env: buildEnv(),
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python install failed in ${cwd} with exit code ${code}`));
    });
  });
}

function serviceVenvPython(cwd) {
  return path.join(cwd, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
}

function createVenv(cwd, pythonCommand) {
  return new Promise((resolve, reject) => {
    const [cmd, ...baseArgs] = pythonCommand;
    const child = spawn(cmd, [...baseArgs, "-m", "venv", ".venv"], {
      cwd,
      stdio: "inherit",
      shell: false,
      env: buildEnv(),
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python virtual environment creation failed in ${cwd} with exit code ${code}`));
    });
  });
}

async function main() {
  const pythonCommand = await resolvePythonCommand();

  for (const dir of serviceDirs) {
    const abs = path.join(rootDir, dir);
    if (fs.existsSync(path.join(abs, "package.json"))) {
      console.log(`Installing service dependencies in ${dir}...`);
      await runInstall(abs);
      continue;
    }

    if (fs.existsSync(path.join(abs, "requirements.txt"))) {
      if (!pythonCommand) {
        console.log(`Skipping ${dir}; Python 3.12+ was not found. Install Python or set PYTHON to install Agno RAG dependencies.`);
        continue;
      }
      const venvPython = serviceVenvPython(abs);
      if (!fs.existsSync(venvPython)) {
        console.log(`Creating Python virtual environment in ${dir}...`);
        await createVenv(abs, pythonCommand);
      }
      console.log(`Installing Python service dependencies in ${dir}...`);
      await runPipInstall(abs, [venvPython]);
      continue;
    }

    {
      console.log(`Skipping ${dir}; no package.json needed.`);
      continue;
    }
  }
  console.log("Local microservice setup complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
