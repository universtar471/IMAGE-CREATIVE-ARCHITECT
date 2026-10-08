/**
 * Knowledge Packs are bundled into the app at build time from /knowledge (read-only data).
 */
import { KnowledgeRegistry } from "@arch/domain";

const modules = import.meta.glob("../../../../knowledge/*/*/pack.json", {
  eager: true,
  import: "default",
});

export const knowledge = new KnowledgeRegistry(
  Object.entries(modules).map(([path, data]) => ({
    source: path.replace(/^.*knowledge\//, ""),
    data,
  })),
);

if (knowledge.issues.length) {
  console.error("[knowledge] invalid packs skipped:", knowledge.issues);
}
