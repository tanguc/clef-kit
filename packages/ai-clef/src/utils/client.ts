/**
 * Configuration for the Clef HTTP client. Requests use plain `fetch`.
 * There is no default server: a self-hosted Clef always needs `baseURL`.
 */
export interface ClefClientConfig {
  /** Bearer key of the Clef server. */
  apiKey: string

  /** Server origin, for example `http://127.0.0.1:18080`. Wins over `baseUrl`. */
  baseURL?: string

  /** Alias of `baseURL`. */
  baseUrl?: string

  /** Headers sent with every request. Wins over `headers`. */
  defaultHeaders?: Record<string, string>

  /** Alias of `defaultHeaders`. */
  headers?: Record<string, string>

  /**
   * Request timeout in milliseconds (default: 35_000, a little above the
   * server's own 30 second execution limit). `0` disables it.
   */
  timeout?: number

  /** Override `fetch`. Defaults to global `fetch`. */
  fetch?: typeof fetch
}

export const CLEF_DEFAULT_TIMEOUT_MS = 35_000

/** Resolved transport settings. */
export interface ClefTransport {
  baseUrl: string
  headers: Record<string, string>
  timeout: number
}

/** Validate the configuration and resolve the base URL (no trailing slash). */
export function resolveClefTransport(config: ClefClientConfig): ClefTransport {
  if (typeof config.apiKey !== 'string' || config.apiKey.trim() === '') {
    throw new Error('Clef apiKey is required')
  }
  const raw = config.baseURL ?? config.baseUrl
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Clef baseURL is required: there is no hosted default')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Clef baseURL is not a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Clef baseURL must use http or https')
  }
  if (url.username || url.password) {
    throw new Error('Clef baseURL must not embed credentials')
  }
  const timeout = config.timeout ?? CLEF_DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeout) || timeout < 0) {
    throw new Error('Clef timeout must be a non-negative integer')
  }
  return {
    baseUrl: raw.replace(/\/+$/, ''),
    headers: config.defaultHeaders ?? config.headers ?? {},
    timeout,
  }
}

function readEnv(name: string): string | undefined {
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env
  const value = env?.[name]
  return value && value.trim() !== '' ? value : undefined
}

/**
 * Read `CLEF_API_KEY` and `CLEF_BASE_URL` from the environment.
 *
 * @throws Error naming the missing variable.
 */
export function getClefConfigFromEnv(): Pick<
  ClefClientConfig,
  'apiKey' | 'baseURL'
> {
  return withClefEnv() as Pick<ClefClientConfig, 'apiKey' | 'baseURL'>
}

/**
 * Fill `apiKey` and the base URL from `CLEF_API_KEY` and `CLEF_BASE_URL`
 * when they are not given. Explicit values always win, and only the
 * missing ones are read from the environment.
 *
 * @throws Error naming the missing variable.
 */
export function withClefEnv(
  config: Partial<ClefClientConfig> = {},
): ClefClientConfig {
  const apiKey = config.apiKey ?? readEnv('CLEF_API_KEY')
  if (!apiKey) throw new Error('CLEF_API_KEY is not set')
  const baseURL = config.baseURL ?? config.baseUrl ?? readEnv('CLEF_BASE_URL')
  if (!baseURL) throw new Error('CLEF_BASE_URL is not set')
  return { ...config, apiKey, baseURL }
}
