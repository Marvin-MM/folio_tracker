import type { OperationStep, OperationVariable } from "./types";

/**
 * Matches `{{variable_key}}` placeholders with optional inner whitespace.
 * Strictly non-recursive: single-pass replacement ensures a user-supplied
 * variable value containing `{{another_key}}` is NEVER expanded a second time.
 */
export const VARIABLE_PLACEHOLDER_REGEX = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/g;

export interface InterpolatedTextResult {
  text: string;
  unresolvedKeys: string[];
}

export interface InterpolatedOperationStep {
  key: string;
  title: string;
  bodyMarkdown: string;
  codeBlock: { language: string; content: string } | null;
  verificationCue: string | null;
  rollbackHint: string | null;
  branchHint: string | null;
  unresolvedKeys: string[];
}

export function extractTemplateVariableKeys(template: string): string[] {
  if (!template) return [];
  const keys = new Set<string>();
  const regex = new RegExp(VARIABLE_PLACEHOLDER_REGEX.source, "g");
  let match: RegExpExecArray | null = regex.exec(template);
  while (match !== null) {
    if (match[1]) {
      keys.add(match[1]);
    }
    match = regex.exec(template);
  }
  return Array.from(keys);
}

/**
 * Single-pass, non-recursive template interpolation.
 *
 * Resolution order for each `{{key}}`:
 * 1. Explicit non-empty runtime value in `values[key]`
 * 2. Non-empty `defaultValue` declared on a non-secret variable in `schema`
 * 3. Otherwise left verbatim as `{{key}}` and recorded in `unresolvedKeys`
 */
export function interpolateTemplate(
  template: string,
  values: Readonly<Record<string, string | undefined>>,
  schema?: readonly OperationVariable[]
): InterpolatedTextResult {
  if (!template) {
    return { text: "", unresolvedKeys: [] };
  }

  const defaults = new Map<string, string>();
  if (schema) {
    for (const variable of schema) {
      if (
        variable.type !== "secret" &&
        typeof variable.defaultValue === "string" &&
        variable.defaultValue.length > 0
      ) {
        defaults.set(variable.key, variable.defaultValue);
      }
    }
  }

  const unresolved = new Set<string>();
  const text = template.replace(
    VARIABLE_PLACEHOLDER_REGEX,
    (originalMatch: string, key: string) => {
      const provided = values[key];
      if (typeof provided === "string" && provided.length > 0) {
        return provided;
      }
      const fallback = defaults.get(key);
      if (fallback !== undefined && fallback.length > 0) {
        return fallback;
      }
      unresolved.add(key);
      return originalMatch;
    }
  );

  return {
    text,
    unresolvedKeys: Array.from(unresolved),
  };
}

export function interpolateStep(
  step: OperationStep,
  values: Readonly<Record<string, string | undefined>>,
  schema?: readonly OperationVariable[]
): InterpolatedOperationStep {
  const unresolved = new Set<string>();
  const collect = (input: string | null | undefined): string => {
    if (!input) return "";
    const result = interpolateTemplate(input, values, schema);
    for (const key of result.unresolvedKeys) {
      unresolved.add(key);
    }
    return result.text;
  };

  const title = collect(step.title);
  const bodyMarkdown = collect(step.bodyMarkdown);
  const codeBlock = step.codeBlock
    ? {
        language: step.codeBlock.language,
        content: collect(step.codeBlock.content),
      }
    : null;
  const verificationCue = step.verificationCue
    ? collect(step.verificationCue)
    : null;
  const rollbackHint = step.rollbackHint ? collect(step.rollbackHint) : null;
  const branchHint = step.branchHint ? collect(step.branchHint) : null;

  return {
    key: step.key,
    title,
    bodyMarkdown,
    codeBlock,
    verificationCue,
    rollbackHint,
    branchHint,
    unresolvedKeys: Array.from(unresolved),
  };
}

/**
 * Security boundary: strips EVERY `type === "secret"` variable AND any key not
 * explicitly declared as non-secret in `schema`.
 *
 * Call before persisting `operation_runs.variables_values_json` to Turso or
 * caching run snapshots / queued mutations in browser `localStorage`.
 */
export function stripSecretVariables(
  values: Readonly<Record<string, string | undefined>>,
  schema: readonly OperationVariable[]
): Record<string, string> {
  const allowedNonSecretKeys = new Set<string>();
  for (const variable of schema) {
    if (variable.type !== "secret") {
      allowedNonSecretKeys.add(variable.key);
    }
  }

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!allowedNonSecretKeys.has(key)) continue;
    if (typeof value !== "string") continue;
    sanitized[key] = value.slice(0, 1000);
  }
  return sanitized;
}
