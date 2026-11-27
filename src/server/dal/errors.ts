import type { SecretScanFinding } from "@/server/domain/operations/secret-scanner";

export class DalError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class UnauthorizedError extends DalError {
  constructor(message = "Authentication required.") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ForbiddenError extends DalError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, "FORBIDDEN", 403);
  }
}

export class EmailMismatchError extends DalError {
  constructor(
    message = "Your signed-in email does not match this invitation."
  ) {
    super(message, "EMAIL_MISMATCH", 403);
  }
}

export class CommentWindowClosedError extends DalError {
  readonly opensAtUtcMs: number | null;
  readonly summary: string;

  constructor(params: {
    message?: string;
    opensAtUtcMs: number | null;
    summary: string;
  }) {
    super(
      params.message ?? `Commenting is currently locked (${params.summary}).`,
      "COMMENT_WINDOW_CLOSED",
      403
    );
    this.opensAtUtcMs = params.opensAtUtcMs;
    this.summary = params.summary;
  }
}

export class MonthLockedError extends DalError {
  readonly yearMonth: string;
  readonly reason: "locked_manual" | "locked_auto";

  constructor(params: {
    yearMonth: string;
    reason: "locked_manual" | "locked_auto";
    message?: string;
  }) {
    super(
      params.message ??
        `${params.yearMonth} is locked and read-only. Unlock the month first to make edits.`,
      "MONTH_LOCKED",
      403
    );
    this.yearMonth = params.yearMonth;
    this.reason = params.reason;
  }
}

export class NotFoundError extends DalError {
  constructor(message = "Requested resource was not found.") {
    super(message, "NOT_FOUND", 404);
  }
}

export class ConflictError extends DalError {
  constructor(message = "Resource conflict detected.") {
    super(message, "CONFLICT", 409);
  }
}

export class ConcurrencyConflictError extends DalError {
  constructor(
    message = "This blueprint was modified elsewhere. Refresh to load the latest version before saving."
  ) {
    super(message, "CONCURRENCY_CONFLICT", 409);
  }
}

export class SecretScanBlockedError extends DalError {
  readonly findings: SecretScanFinding[];

  constructor(
    findings: SecretScanFinding[],
    message = "Publishing blocked: remove detected secrets or convert them into Secret variables first."
  ) {
    super(message, "SECRET_SCAN_BLOCKED", 422);
    this.findings = findings;
  }
}

export class SecretScanWarningAckRequiredError extends DalError {
  readonly warnings: SecretScanFinding[];

  constructor(
    warnings: SecretScanFinding[],
    message = "Review and acknowledge the scanner advisories (such as internal IPs or email addresses) before publishing."
  ) {
    super(message, "SECRET_SCAN_WARNINGS_REQUIRE_ACK", 422);
    this.warnings = warnings;
  }
}

export class ValidationError extends DalError {
  constructor(message = "Invalid input provided.") {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class RateLimitError extends DalError {
  readonly retryAfterSeconds: number;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAtMs: number;

  constructor(params: {
    message?: string;
    retryAfterSeconds: number;
    limit: number;
    remaining: number;
    resetAtMs: number;
  }) {
    super(
      params.message ??
        `Too many requests. Please retry in ${params.retryAfterSeconds}s.`,
      "RATE_LIMITED",
      429
    );
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.limit = params.limit;
    this.remaining = params.remaining;
    this.resetAtMs = params.resetAtMs;
  }
}
