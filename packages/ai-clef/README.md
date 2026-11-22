# @stanguc/ai-clef

TanStack AI evaluate adapter for a self-hosted [Clef](https://huggingface.co/Cloudflare/clef-flash)
server that speaks the SystemOne protocol (`POST /v1/systemone`).

It plugs into `decide()` from `@tanstack/ai`, like `@tanstack/ai-typesafe`, but targets your own
server instead of a hosted API.

## Install

```sh
bunx jsr add @stanguc/ai-clef
# or: npx jsr add @stanguc/ai-clef / deno add jsr:@stanguc/ai-clef
```

`@tanstack/ai` (>= 1.8) must be installed alongside it.

## Usage

```ts
import { boolean, choice, decide, score } from '@tanstack/ai'
import { clefDecider } from '@stanguc/ai-clef'

// reads CLEF_API_KEY and CLEF_BASE_URL, or pass { apiKey, baseURL }
const result = await decide({
  adapter: clefDecider('clef-flash'),
  state: 'Help! My payouts have been failing for 3 days.',
  questions: {
    queue: choice({
      instructions: 'Which team should handle this ticket?',
      options: { billing: 'Payments, refunds', tech: 'Bugs, outages' },
    }),
    urgency: score({
      instructions: 'How urgent is it?',
      levels: ['low', 'medium', 'high'],
    }),
    refund: boolean({ instructions: 'Is the customer asking for a refund?' }),
  },
})
```

## Differences from the hosted adapters

The server is stricter than the TanStack wire types. The adapter refuses these before any network
call, with a `ClefError` whose `code` is `invalid_request`:

- `instructions` must be a non-empty string (no objects or arrays)
- boolean questions take no `criteria`
- every choice option needs a non-empty description
- 1-16 questions, ids and option keys up to 128 characters, 1-32 options or levels
- request body up to 32 KiB, no `NaN` or `Infinity` in `state`

It also:

- requires `baseURL`: there is no hosted default
- applies a 35 second timeout (`timeout` option, `0` disables it)
- refuses redirects and URLs with embedded credentials
- checks that every question got exactly one answer of the right type
- reports the server's short error code in `ClefError.detail` (`model_unavailable`,
  `input_too_long`, `execution_timeout`, ...) and never echoes other upstream text

Clef is a classifier, so `usage.completionTokens` is always 0.

## License

MIT. Derived from `@tanstack/ai-typesafe` in [TanStack/ai](https://github.com/TanStack/ai).
