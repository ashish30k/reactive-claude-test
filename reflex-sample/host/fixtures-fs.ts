// Node-only: loads fixtures from disk by "Domain.scenario" name.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FixtureFile } from "./fixture-transport";

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export class FixtureNotFoundError extends Error {
  readonly code = "FIXTURE_NOT_FOUND";
}

export function fixturePath(name: string): string {
  const [domain, scenario] = name.split(".");
  if (!domain || !scenario) throw new FixtureNotFoundError(`Fixture names look like Domain.scenario, got "${name}"`);
  return join(FIXTURES_DIR, domain, `${scenario}.json`);
}

export function loadFixture(name: string): FixtureFile {
  const path = fixturePath(name);
  if (!existsSync(path)) throw new FixtureNotFoundError(`Fixture ${name} not found (${path})`);
  return JSON.parse(readFileSync(path, "utf8")) as FixtureFile;
}
