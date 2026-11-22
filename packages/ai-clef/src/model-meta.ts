/** Models a self-hosted Clef server answers. The server rejects any other id. */
export const CLEF_EVALUATE_MODELS = ['clef-flash'] as const

/** A model id accepted by a self-hosted Clef server. */
export type ClefEvaluateModel = (typeof CLEF_EVALUATE_MODELS)[number]

/**
 * Request limits enforced by the Clef server. Requests outside them are
 * refused before any network call, instead of coming back as a bare 422.
 */
export const CLEF_LIMITS = {
  /** Questions per request. */
  maxQuestions: 16,
  /** Characters in a question id or a choice key. */
  maxKeyLength: 128,
  /** Options of a choice question, or levels of a score question. */
  maxCriteria: 32,
  /** UTF-8 bytes of the JSON request body. */
  maxBodyBytes: 32768,
} as const
