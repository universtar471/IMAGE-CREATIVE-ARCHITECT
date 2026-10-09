import { Fragment, type ReactNode } from "react";

/**
 * Fill `{name}` placeholders of an already translated string with React nodes, so word
 * order stays the translator's (e.g. "Remove {name} from this project?" with a <strong>).
 */
export function fillNodes(template: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/\{(\w+)\}/);
  return parts.map((part, i) =>
    i % 2 === 1 && part in nodes ? (
      <Fragment key={i}>{nodes[part]}</Fragment>
    ) : (
      <Fragment key={i}>{i % 2 === 1 ? `{${part}}` : part}</Fragment>
    ),
  );
}
