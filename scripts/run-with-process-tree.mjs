import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function terminateProcessTree(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const platform = options.platform ?? process.platform;
  const runSync = options.spawnSyncFn ?? spawnSync;
  if (platform === "win32") {
    const result = runSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true, stdio: "ignore",
    });
    return result.status === 0;
  }
  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}

export function parseRunnerArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("Usage: run-with-process-tree --timeout-ms <milliseconds> -- <command> [args...]");
  }
  const timeoutIndex = argv.indexOf("--timeout-ms");
  const timeoutMs = timeoutIndex >= 0 ? Number.parseInt(argv[timeoutIndex + 1] ?? "", 10) : 0;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100) throw new Error("A timeout of at least 100ms is required.");
  return { timeoutMs, command: argv[separator + 1], args: argv.slice(separator + 2) };
}

export async function runCommand(options) {
  const spawnFn = options.spawnFn ?? spawn;
  const childEnvironment = {
    ...(options.env ?? process.env),
    REPLENISHMENT_PROCESS_TREE_SUPERVISED: "1",
  };
  const child = spawnFn(options.command, options.args ?? [], {
    cwd: options.cwd ?? process.cwd(),
    env: childEnvironment,
    shell: false,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: "inherit",
  });
  let stopping = false;
  let timedOut = false;
  let parentLost = false;
  const stop = () => {
    if (stopping || child.exitCode !== null) return;
    stopping = true;
    terminateProcessTree(child.pid, options);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    stop();
  }, options.timeoutMs);
  timeout.unref?.();
  const parentPid = options.parentPid ?? process.ppid;
  const isProcessAlive = options.isProcessAlive ?? ((pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  });
  const parentWatch = setInterval(() => {
    if (!isProcessAlive(parentPid)) {
      parentLost = true;
      stop();
    }
  }, 500);
  parentWatch.unref?.();

  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => stop();
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    return timedOut ? 124 : parentLost ? 125 : result.code ?? (result.signal ? 1 : 0);
  } finally {
    clearTimeout(timeout);
    clearInterval(parentWatch);
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    stop();
  }
}

async function main() {
  const parsed = parseRunnerArguments(process.argv.slice(2));
  process.exitCode = await runCommand(parsed);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Process-tree runner failed.");
    process.exitCode = 1;
  });
}
