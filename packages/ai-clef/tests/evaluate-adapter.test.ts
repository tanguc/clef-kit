import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InternalLogger } from '@tanstack/ai/adapter-internals'
import type { EvaluateOptions } from '@tanstack/ai/adapters'
import type { WireAnswer, WireQuestion } from '@tanstack/ai'
import { boolean, choice, decide, score } from '@tanstack/ai'
import {
  CLEF_LIMITS,
  ClefError,
  clefDecider,
  createClefDecider,
  isClefError,
} from '../src'

const fetchMock = vi.fn<typeof fetch>()
const BASE = 'http://127.0.0.1:18080'

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function silentLogger() {
  return new InternalLogger(
    { debug() {}, info() {}, warn() {}, error() {} },
    {
      request: false,
      provider: false,
      output: false,
      middleware: false,
      tools: false,
      agentLoop: false,
      config: false,
      errors: false,
      sandbox: false,
    },
  )
}

const state = 'Help! My payouts have been failing for 3 days.'

const questions: Record<string, WireQuestion> = {
  queue: {
    type: 'choice',
    instructions: 'Which team should handle this ticket?',
    criteria: { billing: 'Payments, refunds', tech: 'Bugs, outages' },
  },
  urgency: {
    type: 'score',
    instructions: 'How urgent is this ticket?',
    criteria: ['low', 'medium', 'high'],
  },
  refund: {
    type: 'noul',
    instructions: 'Is the customer asking for a refund?',
  },
}

const answers: Record<string, WireAnswer> = {
  queue: {
    type: 'choice',
    choice: 'billing',
    probabilities: { billing: 0.82, tech: 0.18 },
    confidence: 0.91,
  },
  urgency: {
    type: 'score',
    score: 0.8,
    legend: { '0': 'low', '1': 'medium', '2': 'high' },
    probabilities: { '0': 0.05, '1': 0.3, '2': 0.65 },
    confidence: 0.78,
  },
  refund: { type: 'noul', noul: 0.81 },
}

const ok = {
  model: 'clef-flash',
  answers,
  usage: { input_tokens: 312, output_tokens: 0 },
}

function options(overrides: Partial<EvaluateOptions> = {}): EvaluateOptions {
  return {
    model: 'clef-flash',
    state,
    questions,
    logger: silentLogger(),
    ...overrides,
  }
}

function adapter(extra: { timeout?: number } = {}) {
  return createClefDecider('clef-flash', {
    apiKey: 'test-key',
    baseURL: `${BASE}/`,
    ...extra,
  })
}

async function rejection(promise: Promise<unknown>): Promise<ClefError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(isClefError(error)).toBe(true)
  return error as ClefError
}

describe('configuration', () => {
  it('requires a base URL, there is no hosted default', () => {
    expect(() => createClefDecider('clef-flash', { apiKey: 'k' })).toThrow(
      /baseURL is required/,
    )
  })

  it('refuses credentials in the URL and non-http schemes', () => {
    expect(() =>
      createClefDecider('clef-flash', {
        apiKey: 'k',
        baseURL: 'http://u:p@host',
      }),
    ).toThrow(/credentials/)
    expect(() =>
      createClefDecider('clef-flash', { apiKey: 'k', baseURL: 'ftp://host' }),
    ).toThrow(/http or https/)
  })

  it('reads CLEF_API_KEY and CLEF_BASE_URL', async () => {
    vi.stubEnv('CLEF_API_KEY', 'env-key')
    vi.stubEnv('CLEF_BASE_URL', BASE)
    fetchMock.mockResolvedValue(json(ok))
    await clefDecider('clef-flash').evaluate(options())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/v1/systemone`)
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer env-key',
    )
  })

  it('mixes an explicit base URL with the key from the environment', async () => {
    vi.stubEnv('CLEF_API_KEY', 'env-key')
    vi.stubEnv('CLEF_BASE_URL', '')
    fetchMock.mockResolvedValue(json(ok))
    await clefDecider('clef-flash', { baseURL: 'http://10.0.0.1:9' }).evaluate(
      options(),
    )
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://10.0.0.1:9/v1/systemone')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer env-key',
    )
  })

  it('names the missing variable', () => {
    vi.stubEnv('CLEF_API_KEY', '')
    expect(() => clefDecider('clef-flash')).toThrow(/CLEF_API_KEY/)
  })
})

describe('request', () => {
  it('POSTs the SystemOne body and maps usage', async () => {
    fetchMock.mockResolvedValue(json(ok))
    const result = await adapter().evaluate(options())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE}/v1/systemone`)
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'clef-flash',
      state,
      questions,
    })
    expect(result).toEqual({
      model: 'clef-flash',
      answers,
      usage: { promptTokens: 312, completionTokens: 0, totalTokens: 312 },
    })
  })

  it('custom headers cannot override the bearer key', async () => {
    fetchMock.mockResolvedValue(json(ok))
    await createClefDecider('clef-flash', {
      apiKey: 'real',
      baseURL: BASE,
      headers: { Authorization: 'Bearer other', 'X-Trace': '1' },
    }).evaluate(options())
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer real')
    expect(headers.get('X-Trace')).toBe('1')
  })
})

describe('validation before the network', () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    [
      'object instructions',
      { q: { type: 'noul', instructions: { text: 'x' } } },
      /non-empty string/,
    ],
    [
      'criteria on boolean',
      { q: { type: 'noul', instructions: 'x', criteria: { true: 'y' } } },
      /criteria on a boolean/,
    ],
    [
      'null option description',
      { q: { type: 'choice', instructions: 'x', criteria: { a: null } } },
      /non-empty description/,
    ],
    [
      'empty score level',
      { q: { type: 'score', instructions: 'x', criteria: ['a', ' '] } },
      /non-empty string/,
    ],
    [
      'too many options',
      {
        q: {
          type: 'choice',
          instructions: 'x',
          criteria: Object.fromEntries(
            Array.from({ length: 33 }, (_, i) => [`o${i}`, 'd']),
          ),
        },
      },
      /1-32 options/,
    ],
    [
      'long question id',
      { ['x'.repeat(129)]: { type: 'noul', instructions: 'x' } },
      /1-128 characters/,
    ],
    ['no questions', {}, /1-16 questions/],
  ]

  for (const [name, qs, message] of cases) {
    it(`refuses ${name}`, async () => {
      const error = await rejection(
        adapter().evaluate(
          options({ questions: qs as Record<string, WireQuestion> }),
        ),
      )
      expect(error.code).toBe('invalid_request')
      expect(error.message).toMatch(message)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('refuses 17 questions', async () => {
    const qs = Object.fromEntries(
      Array.from({ length: CLEF_LIMITS.maxQuestions + 1 }, (_, i) => [
        `q${i}`,
        { type: 'noul', instructions: 'x' },
      ]),
    ) as Record<string, WireQuestion>
    expect(
      (await rejection(adapter().evaluate(options({ questions: qs })))).code,
    ).toBe('invalid_request')
  })

  it('refuses non-finite numbers instead of sending null', async () => {
    const error = await rejection(
      adapter().evaluate(options({ state: { amount: Number.NaN } })),
    )
    expect(error.message).toMatch(/non-finite/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a body over the server limit', async () => {
    const error = await rejection(
      adapter().evaluate(
        options({ state: 'x'.repeat(CLEF_LIMITS.maxBodyBytes) }),
      ),
    )
    expect(error.message).toMatch(/at most 32768/)
  })
})

describe('server errors', () => {
  it('surfaces the server code and status', async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 'model_unavailable' } }, 503),
    )
    const error = await rejection(adapter().evaluate(options()))
    expect(error).toMatchObject({
      code: 'http',
      status: 503,
      detail: 'model_unavailable',
    })
    expect(error.message).toBe(
      'Clef evaluate request failed: 503 model_unavailable',
    )
  })

  it('also reads a plain FastAPI detail', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'input_too_long' }, 422))
    const error = await rejection(adapter().evaluate(options()))
    expect(error).toMatchObject({ status: 422, detail: 'input_too_long' })
  })

  it('does not echo arbitrary upstream text', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>proxy secret page</html>', { status: 502 }),
    )
    const error = await rejection(adapter().evaluate(options()))
    expect(error.detail).toBeUndefined()
    expect(error.message).toBe('Clef evaluate request failed: 502')
  })

  it('reports a transport failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    expect((await rejection(adapter().evaluate(options()))).code).toBe(
      'transport',
    )
  })

  it('times out', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal!.reason),
          )
        }),
    )
    const error = await rejection(adapter({ timeout: 20 }).evaluate(options()))
    expect(error.code).toBe('timeout')
  })

  it('passes a caller abort through unchanged', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal!.reason),
          )
        }),
    )
    const pending = adapter().evaluate(
      options({ abortSignal: controller.signal }),
    )
    controller.abort(new Error('user cancelled'))
    await expect(pending).rejects.toThrow('user cancelled')
  })
})

describe('response checks', () => {
  it('refuses a missing answer', async () => {
    const { refund: _drop, ...partial } = answers
    fetchMock.mockResolvedValue(json({ ...ok, answers: partial }))
    expect((await rejection(adapter().evaluate(options()))).code).toBe(
      'invalid_response',
    )
  })

  it('refuses an answer of the wrong type', async () => {
    fetchMock.mockResolvedValue(
      json({ ...ok, answers: { ...answers, refund: answers.queue } }),
    )
    expect((await rejection(adapter().evaluate(options()))).code).toBe(
      'invalid_response',
    )
  })

  it('refuses a choice outside the options', async () => {
    fetchMock.mockResolvedValue(
      json({
        ...ok,
        answers: { ...answers, queue: { ...answers.queue, choice: 'sales' } },
      }),
    )
    expect((await rejection(adapter().evaluate(options()))).code).toBe(
      'invalid_response',
    )
  })

  it('refuses a probability above 1', async () => {
    fetchMock.mockResolvedValue(
      json({
        ...ok,
        answers: { ...answers, refund: { type: 'noul', noul: 1.2 } },
      }),
    )
    expect((await rejection(adapter().evaluate(options()))).code).toBe(
      'invalid_response',
    )
  })
})

describe('decide() integration', () => {
  it('works end to end with the TanStack helpers', async () => {
    fetchMock.mockResolvedValue(json(ok))
    const result = await decide({
      adapter: adapter(),
      state,
      questions: {
        queue: choice({
          instructions: 'Which team should handle this ticket?',
          options: { billing: 'Payments, refunds', tech: 'Bugs, outages' },
        }),
        urgency: score({
          instructions: 'How urgent is this ticket?',
          levels: ['low', 'medium', 'high'],
        }),
        refund: boolean({
          instructions: 'Is the customer asking for a refund?',
        }),
      },
    })
    expect(result).toBeDefined()
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).questions,
    ).toEqual(questions)
  })
})
