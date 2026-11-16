import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const CORE = join(__dirname, "..", "..", "core");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("architecture", () => {
  it("the core is headless: no UI, DOM, Node or host imports", () => {
    const violations: string[] = [];
    for (const file of files(CORE)) {
      const src = readFileSync(file, "utf8");
      const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const spec of imports) {
        if (/^(react|react-dom)(\/|$)/.test(spec) || spec.startsWith("node:") || /\/(host|web|cli)\//.test(spec)) {
          violations.push(`${relative(CORE, file)} imports ${spec}`);
        }
      }
      if (/\b(document|window|localStorage)\./.test(src)) violations.push(`${relative(CORE, file)} touches the DOM`);
    }
    expect(violations).toEqual([]);
  });
});
