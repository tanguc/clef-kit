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

## Writing questions

This guide follows TypeSafe's docs on writing questions, adapted to what a Clef server accepts. The
hosted API allows more than Clef. Where they differ, the hosted feature is listed with the Clef
alternative.

### What `instructions` is

`instructions` is the question, or a statement to judge, about `state`. All of your evaluation
logic goes there.

- The question id never reaches the model. In `refund: boolean(...)`, the key `refund` is only for
  your code. Write the full question in `instructions`.
- Each question sees only `state` and its own `instructions`. Questions run in parallel, so one
  answer never becomes context for another.
- Ask for a snap judgment, the kind a person who knows the domain makes in a second. "Does this
  message convey urgency?" works. "Analyze this message and decide the best course of action" does
  not, so split it into several questions.

### Questions and statements

`instructions` can be a question or a statement. A boolean answer is the probability that the
statement is true.

```ts
boolean({ instructions: 'Does the customer request a refund?' }) // question
boolean({ instructions: 'The customer requests a refund.' }) // statement to judge
```

### Point at parts of the state

`state` can be a string or any JSON object or array. To make a question look at one field, write
its dot-and-index path in backticks:

```ts
const result = await decide({
  adapter: clefDecider('clef-flash'),
  state: {
    ticket: {
      messages: [
        { from: 'customer', text: 'Charged twice for A-104, refund pls' },
      ],
    },
    order: { id: 'A-104', charges: [{ amount_usd: 49 }, { amount_usd: 49 }] },
    refund_policy: 'Duplicate charges are eligible for a refund.',
  },
  questions: {
    refund_requested: boolean({
      instructions: 'Does `ticket.messages[0].text` request a refund?',
    }),
    policy_supports: boolean({
      instructions:
        'Does `refund_policy` support the refund requested in `ticket.messages[0].text`, given `order.charges`?',
    }),
    topic: choice({
      instructions: 'What is the main request in `ticket.messages[0].text`?',
      options: {
        refund: 'The customer wants money back',
        status: 'The customer asks where an order is',
        account: 'Login, password or profile changes',
      },
    }),
  },
})
```

### Extra data goes into `state`, not `instructions`

The hosted API also accepts `instructions` as a JSON object, for example
`{ question, inspect, compare, focus }` or a database row placed next to the question. **Clef
refuses this.** `instructions` must be a non-empty string, and the adapter fails with
`invalid_request` before the request is sent.

Put that data in `state` under a named key and refer to it from the question:

```ts
// hosted only, Clef refuses it:
// boolean({ instructions: { question: 'Same person?', potential_duplicate: dbRow } })

const result = await decide({
  adapter: clefDecider('clef-flash'),
  state: {
    resume: incomingResume,
    potential_duplicate: dbRow, // as it comes from your database, not spliced into a string
  },
  questions: {
    same_person: boolean({
      instructions: 'Is `resume` the same person as `potential_duplicate`?',
    }),
  },
})
```

The same idea works for the `compare` and `focus` fields. Write them as plain sentences in the
question:

```ts
const questions = {
  sender_mismatch: boolean({
    instructions:
      'Does the organization named in `ticket.sender.display_name` conflict with the domain of `ticket.sender.email`?',
  }),
  frustration: score({
    instructions:
      'How frustrated does the customer in `ticket.message` appear? Judge the expressed frustration, not how severe the issue is.',
    levels: ['calm', 'frustrated_but_civil', 'very_angry'],
  }),
}
```

When several questions are worded alike, make the field they look at and the thing they judge
explicit, so they stay distinct.

### Criteria: option descriptions and levels

| Question type        | Hosted API accepts                        | Clef accepts                      |
| -------------------- | ----------------------------------------- | --------------------------------- |
| `choice` options     | string, object, array or `null` per key   | non-empty string per key          |
| `score` levels       | string, object, array or `null` per level | non-empty string per level, 2-255 |
| `boolean` `criteria` | `true` / `false` descriptions             | not accepted, leave it out        |

The most useful pattern is contrastive criteria. Each option says what it covers, what it is not
for, and gives an example, in the same order for every option. The hosted API takes this as an
object per option. With Clef, write it as one string per option:

```ts
const team = choice({
  instructions: 'Which team should handle `ticket.message`?',
  options: {
    billing:
      'Charges, invoices, refunds. Not order tracking or login. Example: "I was charged twice".',
    orders:
      'Order status, delivery, returns. Not charges or login. Example: "Where is my order?".',
    account:
      'Login, password, profile changes. Not charges or orders. Example: "I cannot sign in".',
  },
})
// result.team.value is typed 'billing' | 'orders' | 'account'
```

TanStack's `choice()` types allow `null` as a description (the key alone). Clef refuses that, so
always describe each option.

A boolean question has no criteria with Clef. Put what counts as yes in the question itself:

```ts
// hosted only: boolean({ instructions: 'Is this spam?', criteria: { true: '...', false: '...' } })
boolean({
  instructions:
    'Does `email.body` ask the reader to enter a password or a payment card number?',
})
```

### Images

The hosted API can put images in `state`, `instructions` or criteria through an `assets` map and
the `TypeSafe-Danger-Zone-Images` header. **Clef does not support images.** The adapter sends only
`{ model, state, questions }`. Box questions (find something in an image) are not supported either.

### Keep questions atomic

TypeSafe's docs call this "probably the most important concept". Do not ask "is this spam?". Ask
the small questions that make up the answer, then weigh them in code:

```ts
const r = await decide({
  adapter: clefDecider('clef-flash'),
  state: { email },
  questions: {
    creds: boolean({
      instructions:
        'Does `email.body` ask for a password, a code or card details?',
    }),
    mismatch: boolean({
      instructions:
        'Does the organization in `email.from_name` differ from the domain of `email.from_address`?',
    }),
    reward: boolean({
      instructions:
        'Does `email.body` announce an unexpected prize, refund or reward?',
    }),
  },
})

const spamRisk =
  0.45 * r.creds.probability +
  0.3 * r.mismatch.probability +
  0.25 * r.reward.probability
```

You can change the weights later without changing the questions.

### Ask questions you might not need

Questions in one request run together, so add the ones you may need later to the same call instead
of making a second one. With Clef, the limit is 64 questions and 16,384 input tokens per request
(see [Limits](#limits)), so check that the extra questions still fit.

### Pick the right type

- `choice` for a fixed set of unordered options.
- `score` for a range with defined levels.
- `boolean` for a clear yes or no.

"Is the candidate strong in Python?" is a bad yes/no question. A probability of 0.5 means "unsure",
not "medium skill". Use a score, or a clear yes/no question:

```ts
const questions = {
  // range: use a score
  python_level: score({
    instructions: 'How much professional Python experience does `resume` show?',
    levels: ['none', 'some', 'extensive'],
  }),
  // clear yes/no
  python_at_work: boolean({
    instructions: 'Does `resume` say the candidate used Python in a job?',
  }),
}
```

### No `other` option

Do not add an `other` option to a choice. It competes with your real options for probability. Ask
a separate yes/no question and act on the choice only when it says yes:

```ts
const r = await decide({
  adapter: clefDecider('clef-flash'),
  state: { ticket },
  questions: {
    fits: boolean({
      instructions:
        'Is `ticket.message` about charges, order delivery, or account login?',
    }),
    team: choice({
      instructions: 'Which team should handle `ticket.message`?',
      options: {
        billing: 'Charges, invoices, refunds',
        orders: 'Order status, delivery, returns',
        account: 'Login, password, profile changes',
      },
    }),
  },
})

const route = r.fits.probability >= 0.7 ? r.team.value : 'human'
```

### Dependent questions

Make a second request only when your code cannot build it without the first answer, for example to
fetch more data or to choose the next set of options. Otherwise ask everything in one request.

```ts
const first = await decide({
  adapter: clefDecider('clef-flash'),
  state: { ticket },
  questions: {
    has_order_id: boolean({
      instructions: 'Does `ticket.message` mention an order number?',
    }),
  },
})

if (first.has_order_id.value) {
  const order = await db.orders.findFromText(ticket.message) // needs the first answer
  await decide({
    adapter: clefDecider('clef-flash'),
    state: { ticket, order },
    questions: {
      late: boolean({ instructions: 'Is `order` past its `promised_date`?' }),
    },
  })
}
```

### Reading answers and thresholds

| Type      | `.value`                        | Other fields                                                               |
| --------- | ------------------------------- | -------------------------------------------------------------------------- |
| `boolean` | `true` when P(yes) >= 0.5       | `.probability` (P(yes))                                                    |
| `choice`  | the option key the model picked | `.probability`, `.confidence`, `.probabilities`                            |
| `score`   | the nearest level label         | `.score` (raw), `.probability`, `.confidence`, `.probabilities`, `.legend` |

The 0.5 cutoff of a boolean `.value` is rarely what you want. TypeSafe's docs suggest starting at
0.7 for yes and 0.3 for no, and escalating anything in between:

```ts
function decideYesNo(p: number): 'yes' | 'no' | 'escalate' {
  if (p >= 0.7) return 'yes'
  if (p <= 0.3) return 'no'
  return 'escalate'
}

switch (decideYesNo(result.refund_requested.probability)) {
  case 'yes':
    return issueRefund()
  case 'no':
    return closeTicket()
  case 'escalate':
    return sendToHuman()
}
```

For a choice, `.confidence` tells you how sure the model is. Use it the same way before you act on
`.value`.

### Handling errors

```ts
import { isClefError } from '@stanguc/ai-clef'

try {
  return await decide({ adapter: clefDecider('clef-flash'), state, questions })
} catch (error) {
  if (!isClefError(error)) throw error
  switch (error.detail ?? error.code) {
    case 'model_unavailable': // 503: Clef is not loaded right now, retry later
    case 'worker_failed': // 503: the worker ran out of GPU memory, it reloads after 30 s
    case 'execution_timeout': // 504: the server took more than 30 s
      return retryLater()
    case 'input_too_long': // state + questions are over 16,384 tokens
      return shortenState()
    default: // invalid_request: refused by the adapter before any network call
      throw error
  }
}
```

You can check questions in a test, without a server, with `validateClefQuestions(questions)`. The
limits are exported as `CLEF_LIMITS`.

## Limits

| Limit                     | Clef                                           | Hosted API (for reference)          |
| ------------------------- | ---------------------------------------------- | ----------------------------------- |
| Input tokens per request  | 16,384, for `state` and all questions together | 64k per request, 32k per question   |
| Questions per request     | 1-64                                           | no limit                            |
| Request body              | 256 KiB                                        | 32 MiB                              |
| Question ids, option keys | up to 128 characters                           |                                     |
| Options or levels         | 1-255 options, 2-255 levels                    |                                     |
| Numbers                   | finite only (no `NaN`, `Infinity`)             | finite only                         |
| Run time                  | 30 s on the server, 35 s adapter timeout       |                                     |
| Long context header       | not supported                                  | `TypeSafe-Danger-Zone-Long-Context` |

Instructions and option descriptions are sent with every request, so they use part of the token
budget each time.

These are the limits of one self-hosted deployment, not of the model. clef-flash accepts up to 262K
positions, but this server shares its GPU with a larger model, and 16,384 tokens is the largest input
measured to fit beside it (about 2 s per evaluation). The adapter checks the values in `CLEF_LIMITS`,
which match this deployment. Keep them short, and send ids and large exact values as strings.

## Differences from the hosted adapters

The server is stricter than the TanStack wire types. The adapter refuses these before any network
call, with a `ClefError` whose `code` is `invalid_request`:

- `instructions` must be a non-empty string (no objects or arrays)
- boolean questions take no `criteria`
- every choice option needs a non-empty description
- 1-64 questions, ids and option keys up to 128 characters, 1-255 options or levels
- request body up to 256 KiB, no `NaN` or `Infinity` in `state`

The server also refuses requests over 16,384 input tokens (`input_too_long`). See [Limits](#limits).

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
