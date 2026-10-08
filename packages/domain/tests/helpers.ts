import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KnowledgeRegistry } from "../src/knowledge/registry";

const knowledgeRoot = fileURLToPath(new URL("../../../knowledge", import.meta.url));

/** Load the real seed packs from /knowledge (the same files the desktop app bundles). */
export function loadSeedRegistry(): KnowledgeRegistry {
  const raw: Array<{ source: string; data: unknown }> = [];
  for (const type of readdirSync(knowledgeRoot)) {
    const typeDir = join(knowledgeRoot, type);
    if (!statSync(typeDir).isDirectory()) continue;
    for (const subtype of readdirSync(typeDir)) {
      const file = join(typeDir, subtype, "pack.json");
      raw.push({ source: `${type}/${subtype}`, data: JSON.parse(readFileSync(file, "utf8")) });
    }
  }
  return new KnowledgeRegistry(raw);
}
