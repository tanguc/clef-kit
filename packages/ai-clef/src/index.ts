/**
 * @module @stanguc/ai-clef
 *
 * TanStack AI evaluate adapter for a self-hosted Clef server that speaks
 * the SystemOne protocol (`POST /v1/systemone`).
 */

export {
  ClefEvaluateAdapter,
  clefDecider,
  createClefDecider,
} from './adapters/evaluate.ts'

export { ClefError, isClefError, type ClefErrorCode } from './errors.ts'

export {
  CLEF_DEFAULT_TIMEOUT_MS,
  getClefConfigFromEnv,
  type ClefClientConfig,
} from './utils/client.ts'

export {
  CLEF_EVALUATE_MODELS,
  CLEF_LIMITS,
  type ClefEvaluateModel,
} from './model-meta.ts'

export { validateClefQuestions } from './validate.ts'
