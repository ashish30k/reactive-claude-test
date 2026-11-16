/**
 * Interactive Reflex CLI: use the whole app from a terminal, no UI.
 *
 *   npm run cli                                   # mock shop (in-memory, writable)
 *   npm run cli -- --fixture Orders.browse        # replay recorded fixtures (repeatable flag)
 *   npm run cli -- --live                         # your real store (SHOPIFY_SHOP, SHOPIFY_ADMIN_TOKEN)
 *   npm run cli -- --url shop://orders/1046       # start on a deep link
 *   echo 'do selectTab {"tab":"orders"}' | npm run cli -- --raw   # scriptable, prints JSON
 *
 * Commands:  ls | do <Action> [json] | <Action> [json] | back | tab <name> | tree | raw | help | quit
 */
import { createInterface } from "node:readline";
import { ReflexHost, type HostEvent } from "../host/ReflexHost";
import { transportFactory, type DataSource } from "../host/node-transports";
import type { ReflexNode } from "../core";

const argv = process.argv.slice(2);
const fixtures = argv.flatMap((a, i) => (a === "--fixture" && argv[i + 1] ? [argv[i + 1]!] : []));
const source: DataSource = argv.includes("--live") ? "live" : fixtures.length ? "fixtures" : "mock";
const url = argv[argv.indexOf("--url") + 1] && argv.includes("--url") ? argv[argv.indexOf("--url") + 1] : undefined;
let raw = argv.includes("--raw") || !process.stdin.isTTY;

const c = {
  dim: (s: string) => (raw ? s : `\x1b[2m${s}\x1b[0m`),
  bold: (s: string) => (raw ? s : `\x1b[1m${s}\x1b[0m`),
  green: (s: string) => (raw ? s : `\x1b[32m${s}\x1b[0m`),
  red: (s: string) => (raw ? s : `\x1b[31m${s}\x1b[0m`),
  cyan: (s: string) => (raw ? s : `\x1b[36m${s}\x1b[0m`),
};

const onEvent = (e: HostEvent) => {
  if (e.event === "ready") return;
  if (e.event === "log" && e.level === "debug") return;
  console.error(c.dim(`  ⟡ ${JSON.stringify(e)}`));
};
const host = new ReflexHost(transportFactory(source), onEvent);
let id = 0;
const call = async (req: object) => JSON.parse(await host.handle(JSON.stringify({ id: ++id, ...req })));

function render(node: ReflexNode): string {
  if (raw) return JSON.stringify(node);
  const lines = [c.bold(c.cyan(`▣ ${node.name}`)), c.dim("state:")];
  lines.push(
    ...JSON.stringify(node.state, null, 2)
      .split("\n")
      .map((l) => `  ${l}`),
  );
  lines.push(c.dim("actions:"));
  for (const a of node.actions) {
    const mark = a.enabled ? c.green("✓") : c.dim("✗");
    const payload = a.payload ? ` ${c.dim(JSON.stringify(a.payload))}` : "";
    lines.push(`  ${mark} ${a.enabled ? a.name : c.dim(a.name)}${payload}`);
  }
  return lines.join("\n");
}

function help(): void {
  console.log(`${c.bold("commands")}
  ls                         show the current screen (state + actions)
  do <Action> [json]         perform an action, e.g.  do OpenOrder {"id":"gid://shopify/Order/1046"}
  <Action> [json]            shorthand for do
  back                       do goBack
  tab <home|orders|products> do selectTab
  open <url>                 do openURL, e.g.  open shop://products?filter=lowStock
  tree                       every tab and stack
  raw                        toggle raw JSON output
  quit`);
}

const session = await call({ cmd: "session.create", fixtures, url });
if (!session.ok) {
  console.error(c.red(`${session.error.code}: ${session.error.message}`));
  process.exit(1);
}
const sid = session.session as string;
if (!raw) {
  console.log(c.dim(`Reflex CLI · data: ${source}${fixtures.length ? ` (${fixtures.join(", ")})` : ""} · type "help"`));
}
console.log(render(session.node));

async function run(line: string): Promise<boolean> {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const arg = trimmed.slice(cmd!.length).trim();
  const perform = async (action: string, payload: unknown = {}) => {
    const res = await call({ cmd: "do", session: sid, action, payload });
    console.log(res.ok ? render(res.node) : c.red(`${res.error.code}: ${res.error.message}`));
  };
  switch (cmd) {
    case "quit":
    case "exit":
      return false;
    case "help":
      help();
      return true;
    case "raw":
      raw = !raw;
      return true;
    case "ls": {
      const res = await call({ cmd: "ls", session: sid });
      console.log(render(res.node));
      return true;
    }
    case "tree": {
      const res = await call({ cmd: "tree", session: sid });
      console.log(raw ? JSON.stringify(res.tree) : JSON.stringify(res.tree, null, 2));
      return true;
    }
    case "back":
      await perform("goBack");
      return true;
    case "tab":
      await perform("selectTab", { tab: rest[0] });
      return true;
    case "open":
      await perform("openURL", { url: rest[0] });
      return true;
    default: {
      const [action, json] = cmd === "do" ? [rest[0]!, arg.slice(rest[0]!.length).trim()] : [cmd!, arg];
      let payload: unknown = {};
      if (json) {
        try {
          payload = JSON.parse(json);
        } catch {
          console.log(c.red(`payload must be JSON, e.g. {"id":"..."}`));
          return true;
        }
      }
      await perform(action, payload);
      return true;
    }
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: raw ? "" : c.cyan("reflex› ") });
let chain = Promise.resolve();
rl.prompt();
rl.on("line", (line) => {
  chain = chain.then(async () => {
    if (!(await run(line))) {
      rl.close();
      return;
    }
    rl.prompt();
  });
});
rl.on("close", () => void chain.then(() => process.exit(0)));
