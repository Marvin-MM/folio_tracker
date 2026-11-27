import { z } from "zod";
import {
  OPERATION_DIFFICULTIES,
  OPERATION_DOMAINS,
  OPERATION_RUN_STATUSES,
  OPERATION_RUN_STEP_STATUSES,
  OPERATION_VISIBILITIES,
} from "@/server/db/schema";

export const MAX_OPERATION_TITLE_LENGTH = 160;
export const MAX_OPERATION_SUMMARY_LENGTH = 400;
export const MAX_OPERATION_VARIABLES = 30;
export const MAX_OPERATION_PREREQUISITES = 50;
export const MAX_OPERATION_STEPS = 100;
export const MAX_OPERATION_TAGS = 8;
export const MAX_RUN_STEP_NOTE_LENGTH = 500;
export const MAX_REFERENCE_NOTES = 20;

export const OPERATION_VARIABLE_TYPES = [
  "text",
  "number",
  "select",
  "secret",
] as const;
export type OperationVariableType = (typeof OPERATION_VARIABLE_TYPES)[number];

export const OPERATION_STEP_TYPES = [
  "action",
  "command",
  "decision",
  "caution",
] as const;
export type OperationStepType = (typeof OPERATION_STEP_TYPES)[number];

export const OPERATION_VARIABLE_KEY_REGEX = /^[a-z][a-z0-9_]{0,39}$/;

export const operationDomainSchema = z.enum(OPERATION_DOMAINS);
export const operationDifficultySchema = z.enum(OPERATION_DIFFICULTIES);
export const operationVisibilitySchema = z.enum(OPERATION_VISIBILITIES);
export const operationRunStatusSchema = z.enum(OPERATION_RUN_STATUSES);
export const operationRunStepStatusSchema = z.enum(OPERATION_RUN_STEP_STATUSES);

export const operationVariableSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(
        OPERATION_VARIABLE_KEY_REGEX,
        "Variable keys must start with a lowercase letter and use only a-z, 0-9, and _."
      ),
    label: z.string().trim().min(1, "Label is required.").max(80),
    type: z.enum(OPERATION_VARIABLE_TYPES).default("text"),
    required: z.boolean().default(false),
    defaultValue: z.string().max(240).optional(),
    options: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    placeholder: z.string().max(160).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "select" && (!val.options || val.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Select variables require at least one option.",
      });
    }
    if (val.type === "secret" && val.defaultValue && val.defaultValue.trim().length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultValue"],
        message:
          "Secret variables cannot store a default value. Provide them only at run time.",
      });
    }
  });

export type OperationVariable = z.infer<typeof operationVariableSchema>;

export const operationPrerequisiteSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1, "Item text is required.").max(200),
  detail: z.string().trim().max(400).optional(),
});

export type OperationPrerequisite = z.infer<typeof operationPrerequisiteSchema>;

export const operationStepCodeBlockSchema = z.object({
  language: z.string().trim().min(1).max(32).default("bash"),
  content: z.string().max(8000),
});

export type OperationStepCodeBlock = z.infer<typeof operationStepCodeBlockSchema>;

export const operationStepSchema = z.object({
  key: z.string().trim().min(1).max(64),
  position: z.string().trim().min(1).max(64),
  type: z.enum(OPERATION_STEP_TYPES).default("action"),
  title: z.string().trim().min(1, "Step title is required.").max(200),
  bodyMarkdown: z.string().max(12000).default(""),
  codeBlock: operationStepCodeBlockSchema.nullish(),
  timerSeconds: z.number().int().min(1).max(86400).nullish(),
  verificationCue: z.string().trim().max(500).nullish(),
  rollbackHint: z.string().trim().max(1000).nullish(),
  branchHint: z.string().trim().max(500).nullish(),
});

export type OperationStep = z.infer<typeof operationStepSchema>;

export const operationVariablesSchemaArray = z
  .array(operationVariableSchema)
  .max(MAX_OPERATION_VARIABLES, `At most ${MAX_OPERATION_VARIABLES} variables allowed.`)
  .superRefine((vars, ctx) => {
    const seen = new Set<string>();
    vars.forEach((item, index) => {
      if (seen.has(item.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: `Duplicate variable key "${item.key}".`,
        });
      }
      seen.add(item.key);
    });
  });

export const operationPrerequisitesSchemaArray = z
  .array(operationPrerequisiteSchema)
  .max(
    MAX_OPERATION_PREREQUISITES,
    `At most ${MAX_OPERATION_PREREQUISITES} checklist items allowed.`
  )
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: `Duplicate prerequisite id "${item.id}".`,
        });
      }
      seen.add(item.id);
    });
  });

export const operationStepsSchemaArray = z
  .array(operationStepSchema)
  .min(1, "An operation must have at least one step.")
  .max(MAX_OPERATION_STEPS, `At most ${MAX_OPERATION_STEPS} steps allowed.`)
  .superRefine((steps, ctx) => {
    const seen = new Set<string>();
    steps.forEach((step, index) => {
      if (seen.has(step.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: `Duplicate step key "${step.key}".`,
        });
      }
      seen.add(step.key);
    });
  });

export const operationTagsSchema = z
  .array(z.string().trim().min(1).max(32))
  .max(MAX_OPERATION_TAGS);

export function normalizeOperationTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const clean = raw
      .trim()
      .toLowerCase()
      .replace(/^#+/, "")
      .replace(/\s+/g, "-")
      .slice(0, 32);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      normalized.push(clean);
      if (normalized.length >= MAX_OPERATION_TAGS) break;
    }
  }
  return normalized;
}

export function sortOperationSteps(steps: readonly OperationStep[]): OperationStep[] {
  return [...steps].sort((a, b) => {
    if (a.position < b.position) return -1;
    if (a.position > b.position) return 1;
    return a.key.localeCompare(b.key);
  });
}

export function parseVariablesSchemaJson(json: string): OperationVariable[] {
  try {
    const parsed: unknown = JSON.parse(json);
    const result = z.array(operationVariableSchema).safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function parsePrerequisitesJson(json: string): OperationPrerequisite[] {
  try {
    const parsed: unknown = JSON.parse(json);
    const result = z.array(operationPrerequisiteSchema).safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function parseStepsSnapshotJson(json: string): OperationStep[] {
  try {
    const parsed: unknown = JSON.parse(json);
    const result = z.array(operationStepSchema).safeParse(parsed);
    return result.success ? sortOperationSteps(result.data) : [];
  } catch {
    return [];
  }
}

export function parseOperationTagsJson(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return normalizeOperationTags(
      parsed.filter((item): item is string => typeof item === "string")
    );
  } catch {
    return [];
  }
}

export function parseStringArrayJson(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.trim() && !seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function parseVariableValuesJson(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        OPERATION_VARIABLE_KEY_REGEX.test(key) &&
        typeof value === "string"
      ) {
        clean[key] = value.slice(0, 1000);
      }
    }
    return clean;
  } catch {
    return {};
  }
}
