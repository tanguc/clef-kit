import { BaseEvaluateAdapter } from '@tanstack/ai/adapters'
import type {
  EvaluateAdapterResult,
  EvaluateOptions,
} from '@tanstack/ai/adapters'
import type { TokenUsage } from '@tanstack/ai'
import { ClefError } from '../errors.ts'
import { resolveClefTransport, withClefEnv } from '../utils/client.ts'
import type { ClefClientConfig } from '../utils/client.ts'
import type { ClefEvaluateModel } from '../model-meta.ts'
import {
  encodeClefBody,
  parseClefResponse,
  validateClefQuestions,
} from '../validate.ts'

function errorDetail(text: string): string | undefined {
  // the Clef server answers {"error": {"code": "<short_code>"}}; plain
  // FastAPI {"detail": "<short_code>"} is accepted too. Nothing else is surfaced
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: unknown }
      detail?: unknown
    } | null
    const code = parsed?.error?.code ?? parsed?.detail
    return typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code)
      ? code
      : undefined
  } catch {
    return undefined
  }
}

function requestSignal(
  abortSignal: AbortSignal | undefined,
  timeout: number,
): AbortSignal | undefined {
  const signals: Array<AbortSignal> = []
  if (abortSignal) signals.push(abortSignal)
  if (timeout > 0) signals.push(AbortSignal.timeout(timeout))
  if (signals.length === 0) return undefined
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals)
}

/**
 * Evaluate adapter for a self-hosted Clef server speaking the SystemOne
 * protocol (`POST /v1/systemone`).
 *
 * Compared with the hosted TypeSafe adapter it validates questions against
 * Clef's stricter schema before sending, enforces a request timeout,
 * checks that every question got an answer of the right type, and raises
 * {@link ClefError} with the server's error code.
 */
export class ClefEvaluateAdapter<
  TModel extends ClefEvaluateModel,
> extends BaseEvaluateAdapter<TModel> {
  readonly name = 'clef' as const

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly headers: Record<string, string>
  private readonly timeout: number
  private readonly fetchFn: typeof fetch | undefined

  constructor(config: ClefClientConfig, model: TModel) {
    super({}, model)
    const transport = resolveClefTransport(config)
    this.apiKey = config.apiKey
    this.baseUrl = transport.baseUrl
    this.headers = transport.headers
    this.timeout = transport.timeout
    this.fetchFn = config.fetch
  }

  /**
   * POST `{ model, state, questions }` and return the wire answers plus
   * token usage. Clef is a classifier, so `completionTokens` is always 0.
   *
   * @throws {@link ClefError}
   */
  async evaluate(options: EvaluateOptions): Promise<EvaluateAdapterResult> {
    const { model, state, questions, abortSignal, logger } = options
    validateClefQuestions(questions)
    const body = encodeClefBody({ model, state, questions })
    const fetchFn = this.fetchFn ?? globalThis.fetch
    const signal = requestSignal(abortSignal, this.timeout)

    logger.request(`activity=evaluate provider=${this.name} model=${model}`, {
      provider: this.name,
      model,
    })

    let response: Response
    try {
      response = await fetchFn(`${this.baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: {
          ...this.headers,
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        redirect: 'error',
        ...(signal ? { signal } : {}),
      })
    } catch (cause) {
      const timedOut =
        cause instanceof Error &&
        cause.name === 'TimeoutError' &&
        !abortSignal?.aborted
      if (abortSignal?.aborted) {
        throw cause
      }
      const error = timedOut
        ? new ClefError(
            'timeout',
            `Clef request timed out after ${this.timeout} ms`,
            { cause },
          )
        : new ClefError('transport', 'Clef request failed before a response', {
            cause,
          })
      logger.errors(`${this.name}.evaluate fatal`, {
        error,
        source: `${this.name}.evaluate`,
      })
      throw error
    }

    if (!response.ok) {
      const detail = errorDetail(await response.text().catch(() => ''))
      const error = new ClefError(
        'http',
        `Clef evaluate request failed: ${response.status}${detail ? ` ${detail}` : ''}`,
        { status: response.status, detail },
      )
      logger.errors(`${this.name}.evaluate fatal`, {
        error,
        source: `${this.name}.evaluate`,
      })
      throw error
    }

    let json: unknown
    try {
      json = await response.json()
    } catch (cause) {
      throw new ClefError('invalid_response', 'Clef response was not JSON', {
        cause,
      })
    }
    const parsed = parseClefResponse(json, questions)

    const promptTokens = parsed.usage.input_tokens
    const completionTokens = parsed.usage.output_tokens
    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    }

    return { model: parsed.model, answers: parsed.answers, usage }
  }
}

/**
 * Create a Clef evaluate adapter with explicit settings.
 *
 * @example
 * ```typescript
 * const adapter = createClefDecider('clef-flash', {
 *   apiKey: key,
 *   baseURL: 'http://127.0.0.1:18080',
 * })
 * ```
 */
export function createClefDecider<TModel extends ClefEvaluateModel>(
  model: TModel,
  config: ClefClientConfig,
): ClefEvaluateAdapter<TModel> {
  return new ClefEvaluateAdapter(config, model)
}

/**
 * Create a Clef evaluate adapter from `CLEF_API_KEY` and `CLEF_BASE_URL`.
 * Explicit `config` values win over the environment.
 *
 * @example
 * ```typescript
 * import { decide, boolean } from '@tanstack/ai'
 * import { clefDecider } from '@stanguc/ai-clef'
 *
 * const result = await decide({
 *   adapter: clefDecider('clef-flash'),
 *   state: ticket,
 *   questions: {
 *     refund: boolean({ instructions: 'Is the customer asking for a refund?' }),
 *   },
 * })
 * ```
 */
export function clefDecider<TModel extends ClefEvaluateModel>(
  model: TModel,
  config?: Partial<ClefClientConfig>,
): ClefEvaluateAdapter<TModel> {
  return createClefDecider(model, withClefEnv(config))
}
