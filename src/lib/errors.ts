export type ErrorCode =
  | "invalid_url"
  | "invalid_env"
  | "redis_unavailable"
  | "lock_held"
  | "not_implemented"
  | "rate_limited"
  | "validation_failed"
  | "not_found"
  | "approval_not_allowed"
  | "read_only"
  | "provider_unavailable"
  | "identity_ambiguous"
  | "insufficient_evidence"
  | "internal_error";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly safeMessage: string;

  constructor(
    code: ErrorCode,
    safeMessage: string,
    status = 400,
    options?: { cause?: unknown },
  ) {
    super(safeMessage, options);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.safeMessage = safeMessage;
  }
}

export type ClientError = {
  code: ErrorCode;
  message: string;
  status: number;
};

const SECRET_PATTERNS = [
  /(?<![A-Za-z])sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /REDIS_PASSWORD[=:]\s*\S+/gi,
  /password[=:]\s*\S+/gi,
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[redacted]"),
    value,
  );
}

export function toClientError(error: unknown): ClientError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.safeMessage,
      status: error.status,
    };
  }

  return {
    code: "internal_error",
    message: "An unexpected error occurred.",
    status: 500,
  };
}

export function toSafeError(
  error: unknown,
  stage?: string,
): {
  code: string;
  message: string;
  createdAt: string;
  stage?: string;
} {
  const client = toClientError(error);
  return {
    code: client.code,
    message: client.message,
    createdAt: new Date().toISOString(),
    ...(stage ? { stage } : {}),
  };
}
