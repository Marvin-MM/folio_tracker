import type {
  OperationPrerequisite,
  OperationStep,
  OperationVariable,
} from "./types";

export type SecretScanSeverity = "block" | "warn";

export interface SecretScanFinding {
  id: string;
  severity: SecretScanSeverity;
  ruleId: string;
  ruleLabel: string;
  location: string;
  redactedMatch: string;
  suggestion: string;
}

export interface SecretScanReport {
  hasBlockers: boolean;
  hasWarnings: boolean;
  blockers: SecretScanFinding[];
  warnings: SecretScanFinding[];
  findings: SecretScanFinding[];
}

export interface SecretScanTargetInput {
  title?: string;
  summary?: string;
  variables?: readonly OperationVariable[];
  prerequisites?: readonly OperationPrerequisite[];
  steps?: readonly OperationStep[];
}

const PLACEHOLDER_LITERALS = new Set([
  "changeme",
  "change_me",
  "change-me",
  "placeholder",
  "example",
  "your_password",
  "your-password",
  "your_secret",
  "your-secret",
  "your_token",
  "your-token",
  "your_api_key",
  "your-api-key",
  "my_secret",
  "replace_me",
  "replace-me",
  "redacted",
  "undefined",
  "null",
  "true",
  "false",
  "none",
  "empty",
]);

function isTemplateOrPlaceholder(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed) return true;
  if (/\{\{\s*[a-z][a-z0-9_]{0,39}\s*\}\}/.test(trimmed)) return true;
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(trimmed)) return true;
  if (/^<[A-Za-z0-9_.-]+>$/.test(trimmed)) return true;
  if (/^\*{3,}$/.test(trimmed) || /^x{4,}$/i.test(trimmed)) return true;
  if (PLACEHOLDER_LITERALS.has(trimmed.toLowerCase())) return true;
  return false;
}

export function redactSecretMatch(raw: string): string {
  const clean = raw.trim().replace(/\s+/g, " ");
  if (clean.length <= 8) {
    return "****";
  }
  if (clean.length <= 14) {
    return `${clean.slice(0, 3)}****${clean.slice(-2)}`;
  }
  return `${clean.slice(0, 6)}****...${clean.slice(-3)}`;
}

interface TextSegment {
  location: string;
  text: string;
}

interface ScanRule {
  ruleId: string;
  ruleLabel: string;
  severity: SecretScanSeverity;
  pattern: RegExp;
  suggestion: string;
  shouldSkip?: (match: RegExpExecArray) => boolean;
  redact?: (match: RegExpExecArray) => string;
}

const SCAN_RULES: readonly ScanRule[] = [
  {
    ruleId: "private_key_pem",
    ruleLabel: "Private key block",
    severity: "block",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
    suggestion:
      "Remove the raw private key and reference a local file path or a Secret variable instead.",
  },
  {
    ruleId: "database_url_credentials",
    ruleLabel: "Connection URL with embedded password",
    severity: "block",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mariadb|libsql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/([^:\s/"'`]+):([^@\s/"'`]+)@[^\s"'`]+/gi,
    suggestion:
      "Replace the inline password with a Secret variable like {{db_password}}.",
    shouldSkip: (match) =>
      isTemplateOrPlaceholder(match[1] ?? "") ||
      isTemplateOrPlaceholder(match[2] ?? ""),
    redact: (match) => {
      const full = match[0];
      const pass = match[2] ?? "";
      return pass ? full.replace(`:${pass}@`, ":****@") : redactSecretMatch(full);
    },
  },
  {
    ruleId: "provider_secret_key",
    ruleLabel: "Provider API secret key",
    severity: "block",
    pattern:
      /\b(?:sk_live_|sk_test_|rk_live_|rk_test_|sk-proj-|sk-ant-)[A-Za-z0-9_-]{12,}\b|\bsk-[A-Za-z0-9]{20,}\b/g,
    suggestion:
      "Replace hardcoded API keys with a Secret variable such as {{api_key}}.",
  },
  {
    ruleId: "github_token",
    ruleLabel: "GitHub access token",
    severity: "block",
    pattern:
      /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    suggestion:
      "Replace the GitHub token with a Secret variable like {{github_token}}.",
  },
  {
    ruleId: "slack_token",
    ruleLabel: "Slack API token",
    severity: "block",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    suggestion:
      "Replace the Slack token with a Secret variable like {{slack_token}}.",
  },
  {
    ruleId: "google_api_key",
    ruleLabel: "Google API key",
    severity: "block",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    suggestion:
      "Replace the Google API key with a Secret variable like {{google_api_key}}.",
  },
  {
    ruleId: "aws_access_key",
    ruleLabel: "AWS access key ID",
    severity: "block",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    suggestion:
      "Replace hardcoded AWS credentials with a Secret variable or AWS profile name.",
  },
  {
    ruleId: "resend_api_key",
    ruleLabel: "Resend API key",
    severity: "block",
    pattern: /\bre_[A-Za-z0-9_]{20,}\b/g,
    suggestion:
      "Replace the Resend API key with a Secret variable like {{resend_api_key}}.",
  },
  {
    ruleId: "jwt_token",
    ruleLabel: "Signed JWT token",
    severity: "block",
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    suggestion:
      "Remove the literal JWT token and supply it at runtime via a Secret variable.",
  },
  {
    ruleId: "bearer_token",
    ruleLabel: "Authorization Bearer token",
    severity: "block",
    pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}={0,2})\b/g,
    suggestion:
      "Replace the hardcoded Bearer token with `Bearer {{auth_token}}`.",
    shouldSkip: (match) => isTemplateOrPlaceholder(match[1] ?? ""),
    redact: (match) => `Bearer ${redactSecretMatch(match[1] ?? "")}`,
  },
  {
    ruleId: "credential_assignment",
    ruleLabel: "Hardcoded credential assignment",
    severity: "block",
    pattern:
      /(?:^|[\s,;({])((?:password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key|client[_-]?secret|db[_-]?pass(?:word)?)\s*[:=]\s*)(["']?)([^\s"'`,;)}]{6,})\2/gi,
    suggestion:
      "Replace literal passwords or tokens with a Secret variable like {{secret_value}}.",
    shouldSkip: (match) => isTemplateOrPlaceholder(match[3] ?? ""),
    redact: (match) =>
      `${(match[1] ?? "").trim()} ${redactSecretMatch(match[3] ?? "")}`,
  },
  {
    ruleId: "private_rfc1918_ip",
    ruleLabel: "Private network IP address",
    severity: "warn",
    pattern:
      /\b(?:10\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|192\.168\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|172\.(?:1[6-9]|2\d|3[0-1])\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d))\b/g,
    suggestion:
      "Consider using a dynamic variable like {{server_ip}} instead of an internal IP before sharing.",
    redact: (match) => match[0],
  },
  {
    ruleId: "personal_email",
    ruleLabel: "Email address",
    severity: "warn",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    suggestion:
      "Consider replacing personal emails with a variable like {{contact_email}} before publishing.",
    shouldSkip: (match) => {
      const lower = match[0].toLowerCase();
      return (
        lower.endsWith("@example.com") ||
        lower.endsWith("@example.org") ||
        lower.endsWith("@example.net") ||
        lower.endsWith("@folio.test") ||
        lower.endsWith("@localhost.local")
      );
    },
    redact: (match) => {
      const [local, domain] = match[0].split("@");
      if (!local || !domain) return redactSecretMatch(match[0]);
      const prefix = local.slice(0, Math.min(2, local.length));
      return `${prefix}***@${domain}`;
    },
  },
];

function collectSegments(input: SecretScanTargetInput): TextSegment[] {
  const segments: TextSegment[] = [];

  if (input.title) {
    segments.push({ location: "Title", text: input.title });
  }
  if (input.summary) {
    segments.push({ location: "Summary", text: input.summary });
  }

  (input.prerequisites ?? []).forEach((item, index) => {
    const label = `Checklist item #${index + 1}`;
    if (item.label) segments.push({ location: label, text: item.label });
    if (item.detail) {
      segments.push({ location: `${label} detail`, text: item.detail });
    }
  });

  (input.variables ?? []).forEach((variable) => {
    if (variable.defaultValue && variable.defaultValue.trim().length > 0) {
      segments.push({
        location: `Variable "{{${variable.key}}}" default`,
        text: variable.defaultValue,
      });
    }
  });

  (input.steps ?? []).forEach((step, index) => {
    const prefix = `Step ${index + 1} ("${step.title.slice(0, 32)}")`;
    if (step.title) segments.push({ location: `${prefix} title`, text: step.title });
    if (step.bodyMarkdown) {
      segments.push({ location: `${prefix} instructions`, text: step.bodyMarkdown });
    }
    if (step.codeBlock?.content) {
      segments.push({
        location: `${prefix} command/snippet`,
        text: step.codeBlock.content,
      });
    }
    if (step.verificationCue) {
      segments.push({
        location: `${prefix} verification`,
        text: step.verificationCue,
      });
    }
    if (step.rollbackHint) {
      segments.push({
        location: `${prefix} rollback`,
        text: step.rollbackHint,
      });
    }
    if (step.branchHint) {
      segments.push({
        location: `${prefix} decision hint`,
        text: step.branchHint,
      });
    }
  });

  return segments;
}

/**
 * Pure, deterministic secret & PII scanner for Operation Blueprints.
 * Never returns raw matched secrets — all excerpts are redacted.
 */
export function scanOperationForSecrets(
  input: SecretScanTargetInput
): SecretScanReport {
  const findings: SecretScanFinding[] = [];
  const dedupe = new Set<string>();

  // Explicitly block any secret variable that attempts to store a default value.
  for (const variable of input.variables ?? []) {
    if (
      variable.type === "secret" &&
      variable.defaultValue &&
      variable.defaultValue.trim().length > 0
    ) {
      const id = `secret-var-default:${variable.key}`;
      dedupe.add(id);
      findings.push({
        id,
        severity: "block",
        ruleId: "secret_variable_default",
        ruleLabel: "Default value on a Secret variable",
        location: `Variable "{{${variable.key}}}"`,
        redactedMatch: redactSecretMatch(variable.defaultValue),
        suggestion:
          "Clear the default value on Secret variables so secrets stay in RAM only during execution.",
      });
    }
  }

  const segments = collectSegments(input);
  let counter = 0;

  for (const segment of segments) {
    for (const rule of SCAN_RULES) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null = regex.exec(segment.text);
      while (match !== null) {
        if (!rule.shouldSkip?.(match)) {
          const redacted = rule.redact
            ? rule.redact(match)
            : redactSecretMatch(match[0]);
          const dedupeKey = `${rule.ruleId}|${segment.location}|${redacted}`;
          if (!dedupe.has(dedupeKey)) {
            dedupe.add(dedupeKey);
            counter += 1;
            findings.push({
              id: `${rule.ruleId}-${counter}`,
              severity: rule.severity,
              ruleId: rule.ruleId,
              ruleLabel: rule.ruleLabel,
              location: segment.location,
              redactedMatch: redacted,
              suggestion: rule.suggestion,
            });
          }
        }
        // Guard against zero-length match loops.
        if (match.index === regex.lastIndex) {
          regex.lastIndex += 1;
        }
        match = regex.exec(segment.text);
      }
    }
  }

  const blockers = findings.filter((item) => item.severity === "block");
  const warnings = findings.filter((item) => item.severity === "warn");

  return {
    hasBlockers: blockers.length > 0,
    hasWarnings: warnings.length > 0,
    blockers,
    warnings,
    findings,
  };
}
