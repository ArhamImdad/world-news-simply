import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { assertAppEnvironment, DATABASE_ENVIRONMENT_VARIABLES } from "../lib/environment-isolation.ts";

function parseEnvironmentFile(path, required) {
  if (!existsSync(path)) {
    if (required) throw new Error(`Required environment file is missing: ${path}`);
    return {};
  }
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

function fallbackEnvironmentKeys(cwd) {
  const keys = new Set(DATABASE_ENVIRONMENT_VARIABLES);
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local", ".env.test", ".env.test.local"]) {
    for (const key of Object.keys(parseEnvironmentFile(resolve(cwd, name), false))) keys.add(key);
  }
  return keys;
}

export function isolatedChildEnvironment(options) {
  const cwd = options.cwd ?? process.cwd();
  const inheritedLock = process.env.APP_ENV_LOCK?.trim();
  if (inheritedLock && inheritedLock !== options.mode) {
    throw new Error(`APP_ENV is locked to ${inheritedLock}; refusing nested ${options.mode} command.`);
  }
  const fileValues = options.environmentFile === "-" ? {} :
    parseEnvironmentFile(resolve(cwd, options.environmentFile), true);
  const environment = { ...process.env };
  for (const key of fallbackEnvironmentKeys(cwd)) environment[key] = "";
  Object.assign(environment, fileValues, { APP_ENV: options.mode, APP_ENV_LOCK: options.mode });
  assertAppEnvironment(environment);
  return environment;
}

export async function runWithAppEnvironment(argv = process.argv.slice(2)) {
  const separator = argv.indexOf("--");
  if (separator !== 2 || argv.length < 4) {
    throw new Error("Usage: run-with-app-env <local|production|staging|test> <env-file|-> -- <command> [args...]");
  }
  const [mode, environmentFile] = argv;
  const environment = isolatedChildEnvironment({ mode, environmentFile });
  const command = argv[separator + 1];
  const args = argv.slice(separator + 2);
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: environment, shell: false,
      windowsHide: true, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runWithAppEnvironment().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Environment isolation failed.");
    process.exitCode = 1;
  });
}
