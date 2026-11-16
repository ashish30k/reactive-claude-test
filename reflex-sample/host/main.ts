// stdio host: `npm run host [-- --mock|--live]`. One JSON request per line in, one response per line out.
import { createInterface } from "node:readline";
import { ReflexHost } from "./ReflexHost";
import { transportFactory, type DataSource } from "./node-transports";

const source: DataSource = process.argv.includes("--live") ? "live" : process.argv.includes("--mock") ? "mock" : "fixtures";
const out = (o: unknown) => process.stdout.write(`${typeof o === "string" ? o : JSON.stringify(o)}\n`);
const host = new ReflexHost(transportFactory(source), out);

// Serialize requests: each `do` must finish before the next starts.
let chain = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  chain = chain.then(async () => {
    out(await host.handle(line));
  });
});
