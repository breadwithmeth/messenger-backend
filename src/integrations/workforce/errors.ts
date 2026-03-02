export class UpstreamError extends Error {
  public readonly upstream: string;
  public readonly statusCode?: number;
  public readonly safeMessage: string;
  public readonly details?: unknown;
  public readonly cause?: unknown;

  constructor(args: {
    upstream: string;
    safeMessage: string;
    statusCode?: number;
    details?: unknown;
    cause?: unknown;
  }) {
    super(args.safeMessage);
    this.name = this.constructor.name;
    this.upstream = args.upstream;
    this.safeMessage = args.safeMessage;
    this.statusCode = args.statusCode;
    this.details = args.details;
    this.cause = args.cause;
  }
}

export class UpstreamAuthError extends UpstreamError {}
export class UpstreamForbiddenError extends UpstreamError {}
export class UpstreamNotFoundError extends UpstreamError {}
export class UpstreamConflictError extends UpstreamError {}
export class UpstreamUnavailableError extends UpstreamError {}
export class UpstreamBadRequestError extends UpstreamError {}

export function mapWorkforceUpstreamError(args: {
  statusCode?: number;
  responseBody?: unknown;
  cause?: unknown;
}): UpstreamError {
  const upstream = 'naliv-emp';
  const details = args.responseBody;
  const statusCode = args.statusCode;

  if (statusCode === 401) {
    return new UpstreamAuthError({
      upstream,
      statusCode,
      safeMessage: 'Workforce auth failed',
      details,
      cause: args.cause,
    });
  }
  if (statusCode === 403) {
    return new UpstreamForbiddenError({
      upstream,
      statusCode,
      safeMessage: 'Workforce access forbidden',
      details,
      cause: args.cause,
    });
  }
  if (statusCode === 404) {
    return new UpstreamNotFoundError({
      upstream,
      statusCode,
      safeMessage: 'Workforce resource not found',
      details,
      cause: args.cause,
    });
  }
  if (statusCode === 409) {
    return new UpstreamConflictError({
      upstream,
      statusCode,
      safeMessage: 'Workforce conflict',
      details,
      cause: args.cause,
    });
  }

  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return new UpstreamBadRequestError({
      upstream,
      statusCode,
      safeMessage: 'Workforce request rejected',
      details,
      cause: args.cause,
    });
  }

  return new UpstreamUnavailableError({
    upstream,
    statusCode,
    safeMessage: 'Workforce service unavailable',
    details,
    cause: args.cause,
  });
}
