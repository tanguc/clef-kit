import type { WireAnswer, WireQuestion } from '@tanstack/ai'
import { ClefError } from './errors.ts'
import { CLEF_LIMITS } from './model-meta.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new ClefError('invalid_request', message)
}

function checkKey(key: string, what: string): void {
  if (key.length < 1 || key.length > CLEF_LIMITS.maxKeyLength) {
    invalid(`${what} must be 1-${CLEF_LIMITS.maxKeyLength} characters`)
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Check questions against what the Clef server accepts. The TanStack wire
 * types allow more (object instructions, yes/no criteria, null option
 * descriptions); Clef refuses those, so they fail here with a clear message.
 */
export function validateClefQuestions(
  questions: Record<string, WireQuestion>,
): void {
  const ids = Object.keys(questions)
  if (ids.length < 1 || ids.length > CLEF_LIMITS.maxQuestions) {
    invalid(
      `Clef accepts 1-${CLEF_LIMITS.maxQuestions} questions, got ${ids.length}`,
    )
  }
  for (const id of ids) {
    checkKey(id, 'Question id')
    const question = questions[id] as WireQuestion
    if (!nonEmptyString(question.instructions)) {
      invalid(
        `Question "${id}": Clef requires instructions as a non-empty string`,
      )
    }
    switch (question.type) {
      case 'noul':
        if ('criteria' in question && question.criteria !== undefined) {
          invalid(
            `Question "${id}": Clef does not accept criteria on a boolean question`,
          )
        }
        break
      case 'choice': {
        const entries = Object.entries(question.criteria)
        if (entries.length < 1 || entries.length > CLEF_LIMITS.maxCriteria) {
          invalid(
            `Question "${id}": Clef accepts 1-${CLEF_LIMITS.maxCriteria} options`,
          )
        }
        for (const [key, description] of entries) {
          checkKey(key, `Question "${id}" option`)
          if (!nonEmptyString(description)) {
            invalid(
              `Question "${id}" option "${key}": Clef requires a non-empty description`,
            )
          }
        }
        break
      }
      case 'score': {
        const levels = question.criteria
        if (levels.length < 1 || levels.length > CLEF_LIMITS.maxCriteria) {
          invalid(
            `Question "${id}": Clef accepts 1-${CLEF_LIMITS.maxCriteria} levels`,
          )
        }
        if (!levels.every(nonEmptyString)) {
          invalid(`Question "${id}": every level must be a non-empty string`)
        }
        break
      }
      default:
        invalid(`Question "${id}": unsupported type`)
    }
  }
}

/**
 * Serialize the request body. Fails instead of letting `JSON.stringify`
 * silently turn NaN or Infinity into null, and enforces the server's
 * body size limit.
 */
export function encodeClefBody(body: unknown): string {
  let text: string
  try {
    text = JSON.stringify(body, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new ClefError(
          'invalid_request',
          'State contains a non-finite number',
        )
      }
      return value
    })
  } catch (error) {
    if (error instanceof ClefError) throw error
    throw new ClefError('invalid_request', 'State is not JSON-serializable', {
      cause: error,
    })
  }
  const bytes = new TextEncoder().encode(text).length
  if (bytes > CLEF_LIMITS.maxBodyBytes) {
    invalid(
      `Request body is ${bytes} bytes, Clef accepts at most ${CLEF_LIMITS.maxBodyBytes}`,
    )
  }
  return text
}

function isProbability(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  )
}

function isProbabilities(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isProbability)
}

/** Response shape the Clef server returns. */
export interface ClefResponse {
  model: string
  answers: Record<string, WireAnswer>
  usage: { input_tokens: number; output_tokens: number }
}

function isAnswer(value: unknown, question: WireQuestion): value is WireAnswer {
  if (!isRecord(value) || value['type'] !== question.type) return false
  switch (question.type) {
    case 'noul':
      return isProbability(value['noul'])
    case 'choice':
      return (
        typeof value['choice'] === 'string' &&
        value['choice'] in question.criteria &&
        isProbabilities(value['probabilities']) &&
        isProbability(value['confidence'])
      )
    case 'score':
      return (
        typeof value['score'] === 'number' &&
        Number.isFinite(value['score']) &&
        isProbabilities(value['probabilities']) &&
        isProbability(value['confidence'])
      )
    default:
      return false
  }
}

/**
 * Check a decoded response: model and usage present, and exactly one answer
 * of the right type for every question asked.
 */
export function parseClefResponse(
  value: unknown,
  questions: Record<string, WireQuestion>,
): ClefResponse {
  const fail = (): never => {
    throw new ClefError(
      'invalid_response',
      'Clef response had an unexpected shape',
    )
  }
  if (!isRecord(value) || !nonEmptyString(value['model'])) return fail()
  const usage = value['usage']
  const answers = value['answers']
  if (
    !isRecord(usage) ||
    typeof usage['input_tokens'] !== 'number' ||
    typeof usage['output_tokens'] !== 'number' ||
    !isRecord(answers)
  ) {
    return fail()
  }
  const asked = Object.keys(questions)
  if (Object.keys(answers).length !== asked.length) return fail()
  const checked: Record<string, WireAnswer> = {}
  for (const id of asked) {
    const answer = answers[id]
    if (!isAnswer(answer, questions[id] as WireQuestion)) return fail()
    checked[id] = answer
  }
  return {
    model: value['model'],
    answers: checked,
    usage: {
      input_tokens: usage['input_tokens'],
      output_tokens: usage['output_tokens'],
    },
  }
}
