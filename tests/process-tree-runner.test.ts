import { describe, expect, it, vi } from "vitest";

// The executable is deliberately plain ESM so Node can start it without a
// TypeScript wrapper or npm/cmd child process.
import { parseRunnerArguments, terminateProcessTree } from "../scripts/run-with-process-tree.mjs";

describe("cross-platform process-tree runner", () => {
  it("uses taskkill with recursive forced termination on Windows", () => {
    const spawnSyncFn = vi.fn(() => ({ status: 0 }));
    expect(terminateProcessTree(4242, { platform: "win32", spawnSyncFn })).toBe(true);
    expect(spawnSyncFn).toHaveBeenCalledWith("taskkill", ["/PID", "4242", "/T", "/F"], {
      windowsHide: true, stdio: "ignore",
    });
  });

  it("requires a bounded timeout and a direct command", () => {
    expect(parseRunnerArguments(["--timeout-ms", "1000", "--", "node", "worker.mjs"]))
      .toEqual({ timeoutMs: 1000, command: "node", args: ["worker.mjs"] });
    expect(() => parseRunnerArguments(["--", "node"])).toThrow("timeout");
  });

  it("marks child environments as process-tree supervised", async () => {
    const child = {
      pid: 42,
      exitCode: 0,
      once(event: string, handler: (...args: unknown[]) => void) {
        if (event === "exit") queueMicrotask(() => handler(0, null));
        return this;
      },
    };
    const spawnFn = vi.fn(() => child);
    // The executable is JavaScript and intentionally accepts injectable test doubles.
    const { runCommand } = await import("../scripts/run-with-process-tree.mjs");
    await runCommand({
      command: "node", args: [], timeoutMs: 1_000, spawnFn,
      parentPid: 1, isProcessAlive: () => true,
    });
    const calls = spawnFn.mock.calls as unknown as Array<[string, string[], { env: Record<string, string> }]>;
    expect(calls[0][2].env.REPLENISHMENT_PROCESS_TREE_SUPERVISED).toBe("1");
  });
});
