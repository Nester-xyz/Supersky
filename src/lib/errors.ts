/** Error codes surfaced by AT Protocol XRPC responses that the UI reacts to. */
export const ERROR_CODES = {
  authFactorRequired: 'AuthFactorTokenRequired',
  authRequired: 'AuthRequired',
  rateLimited: 'RateLimitExceeded',
} as const;

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Something went wrong. Please try again.';
}

/** XRPC errors carry a machine-readable `error` field alongside `message`. */
export function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'error' in err) {
    const code = (err as { error: unknown }).error;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export function httpStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/** Translate common sign-in failures into human-sized messages. */
export function friendlyAuthError(err: unknown): string {
  const code = errorCode(err);
  const status = httpStatus(err);
  if (code === ERROR_CODES.rateLimited) {
    return 'Too many attempts — Bluesky rate-limited this device. Try again in a few minutes.';
  }
  if (status === 401 || /invalid identifier or password/i.test(toErrorMessage(err))) {
    return 'Invalid handle or app password. Double-check both and try again.';
  }
  if (status === 0 || /failed to fetch|network/i.test(toErrorMessage(err))) {
    return 'Could not reach the server. Check your connection (or your PDS URL) and try again.';
  }
  return toErrorMessage(err);
}
