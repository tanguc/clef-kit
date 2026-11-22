/** Error codes raised by this adapter before or after the HTTP call. */
export type ClefErrorCode =
  | 'invalid_request'
  | 'transport'
  | 'timeout'
  | 'http'
  | 'invalid_response'

/**
 * Raised by the Clef adapter. `status` is the HTTP status for `http` errors,
 * and `detail` carries the server's short error code, such as
 * `model_unavailable`, `input_too_long` or `execution_timeout`.
 * The request body is never included.
 */
export class ClefError extends Error {
  override readonly name = 'ClefError'
  readonly code: ClefErrorCode
  readonly status?: number
  readonly detail?: string

  constructor(
    code: ClefErrorCode,
    message: string,
    options: { status?: number; detail?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.code = code
    this.status = options.status
    this.detail = options.detail
  }
}

/** True when `value` looks like a {@link ClefError}, across package copies. */
export function isClefError(value: unknown): value is ClefError {
  return (
    value instanceof Error &&
    value.name === 'ClefError' &&
    typeof (value as { code?: unknown }).code === 'string'
  )
}
