/** Immutable update of a nested value by dotted path, creating objects as needed. */
export function setIn<T>(root: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const clone = (v: unknown): Record<string, unknown> | unknown[] =>
    Array.isArray(v) ? [...v] : { ...(v as Record<string, unknown>) };
  const out = clone(root) as Record<string, unknown>;
  let cursor: Record<string, unknown> = out;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      if (value === undefined && !Array.isArray(cursor)) delete cursor[key];
      else cursor[key] = value;
      return;
    }
    const next = cursor[key];
    cursor[key] = next && typeof next === "object" ? clone(next) : {};
    cursor = cursor[key] as Record<string, unknown>;
  });
  return out as T;
}

export function getIn(root: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      root,
    );
}
