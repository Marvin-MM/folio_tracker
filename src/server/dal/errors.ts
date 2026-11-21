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
