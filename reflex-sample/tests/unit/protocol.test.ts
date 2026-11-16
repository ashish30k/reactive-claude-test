/**
 * Drives the real stdio host process exactly like an external agent would:
 * newline-delimited JSON over stdin/stdout. Nothing TypeScript-specific.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("NDJSON protocol over stdio", () => {
  it("creates a session, performs actions and reports errors", async () => {
    const root = join(__dirname, "..", "..");
    const proc = spawn(process.execPath, ["--import", "tsx", "host/main.ts"], { cwd: root });
    const lines = createInterface({ input: proc.stdout });
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    lines.on("line", (l) => (queue.push(l), wake?.()));
    const next = async () => {
      while (!queue.length) await new Promise<void>((r) => (wake = r));
      return JSON.parse(queue.shift()!);
    };
    const send = async (o: object) => (proc.stdin.write(`${JSON.stringify(o)}\n`), next());

    try {
      expect(await next()).toEqual({ event: "ready", protocol: 1 });

      const created = await send({ id: 1, cmd: "session.create", fixtures: ["Home.default", "Orders.browse"] });
      expect(created).toMatchObject({ id: 1, ok: true, session: "s1", node: { name: "Home" } });

      const tab = await send({ id: 2, cmd: "do", session: "s1", action: "selectTab", payload: { tab: "orders" } });
      expect(tab.node.name).toBe("OrdersList");
      expect(tab.node.state.orders).toHaveLength(20);
      expect(tab.node.state).not.toHaveProperty("_endCursor"); // internals stay internal

      expect(await send({ id: 3, cmd: "do", session: "s1", action: "Nope" })).toMatchObject({
        id: 3,
        ok: false,
        error: { code: "ACTION_NOT_AVAILABLE" },
      });
      expect(await send({ id: 4, cmd: "ls", session: "s9" })).toMatchObject({ ok: false, error: { code: "UNKNOWN_SESSION" } });
      expect(await send({ id: 5, cmd: "session.create", fixtures: ["Nope.missing"] })).toMatchObject({
        ok: false,
        error: { code: "FIXTURE_NOT_FOUND" },
      });
    } finally {
      proc.kill();
    }
  }, 20_000);
});
