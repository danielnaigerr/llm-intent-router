# LLM Intent Router

A router-based chatbot that uses an LLM **only for intent classification**, then
dispatches each message to a deterministic handler. Most answers never come from
the model at all — they come from ordinary code, an external API, or a lookup
table. The LLM is used where it is genuinely better than code, and kept out of
everything else.

Alongside the chatbot, the server exposes a small product-reviews REST API backed
by MySQL, with LLM-generated review summaries cached for seven days.

---

## ⚠️ This is not clone-and-run

Worth knowing before you spend time on setup:

- **A paid OpenAI API key is required.** There is no local-model fallback, no
  offline mode, and no mock provider. `packages/server/llm/client.ts` talks to
  the OpenAI API and nothing else. Without a funded key, the chat endpoint, math
  word problems, review analysis and review summarization all fail.
- **A MySQL database is required.** The server imports the generated Prisma
  client at startup, so `prisma generate` has to run even if you only care about
  the chatbot.
- **There is no seed data.** The `products` and `reviews` tables ship empty, so
  `/api/products/:id/reviews` returns `Product does not exist` until you insert
  rows yourself.

---

## What it does

Every message triggers one classification call, then exactly one handler:

| Intent | Handler | Uses the LLM? | How it answers |
|---|---|---|---|
| `weather` | `services/apps/weather.app.ts` | **No** | Geocodes the city and reads current conditions from the free open-meteo API |
| `math` | `services/apps/math.app.ts` | Only for word problems | Evaluates a character-whitelisted expression. Word problems get one chain-of-thought call to turn prose into an expression, then the same deterministic evaluation |
| `exchange` | `services/apps/exchange.app.ts` | **No** | Static rate table plus a regex that pulls the amount out of the message |
| `analyzeReview` | `services/apps/reviewAnalyzer.app.ts` | Yes | Aspect-based sentiment analysis returned as JSON, validated with zod, with a self-correction retry when sentiment and score disagree |
| `general` | `services/apps/general.app.ts` | Yes | Keyword guardrails first, then a persona-driven completion with the last 20 turns of history |

Real exchanges from a development session:

```text
> I am flying to London and I need to know if I should bring a coat.
  London, United Kingdom: 7.3°C, rain showers, wind 13.2 km/h        [weather]

> John has 5 apples, he ate 2 and bought 10 more. How many does he have now?
  The result is 13                                                  [math + CoT]

> What do you think about politics in Israel?
  I cannot process this request: political discussions are not
  within my scope due to safety protocols.                          [guardrail]

> The pizza was amazing but the delivery guy was an hour late. Analyze the review.
  Summary: Great pizza but poor delivery timing.
  Overall sentiment: Mixed
  Score: 5/10
  Detailed aspects:
   1. food quality (Positive): "The pizza was amazing"
   2. delivery (Negative): "The delivery guy was an hour late"      [analyzeReview]
```

Typing `/reset` clears all stored conversation history.

---

## Architecture

```text
Browser (React)
     |  POST /api/chat  { prompt, conversationId }
     v
chat.controller.ts ---> zod: prompt 1-1000 chars, conversationId must be a UUID
     |
     v
router.service.ts
     |
     +- classify()  ---->  gpt-4o-mini, temperature 0, JSON-only prompt
     |                     returns { intent, parameters, confidence }
     |                     falls back to "general" on unparseable output
     |
     +- weather -------->  open-meteo geocoding + forecast     (no LLM)
     +- math ----------->  Function() over a whitelisted expr  (no LLM)
     +- exchange ------->  static rate table                   (no LLM)
     +- analyzeReview -->  gpt-4o-mini -> zod -> optional fix pass
     +- general -------->  guardrails -> gpt-4o-mini + history
     |
     v
history.repository.ts ---> appends both turns, rewrites history.json on disk
     |
     v
{ message }        <- the router also returns `intent`, the controller drops it
```

The second, independent surface:

```text
GET  /api/products/:id/reviews            -> Prisma: reviews + cached summary
POST /api/products/:id/reviews/summarize  -> cached summary, or gpt-4.1 then cache 7 days
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | **Bun** — the workspace, `Bun.file`/`Bun.write`, and importing `.txt` prompts as strings |
| Monorepo | Bun workspaces; `concurrently` runs server and client from one command |
| Server | Express 5, TypeScript (strict) |
| LLM | `openai` v6 via the **Responses API** (`client.responses.create`) |
| Models | `gpt-4o-mini` everywhere except review summarization, which uses `gpt-4.1` |
| Validation | zod v4 — on the chat request body and on LLM JSON output |
| Database | MySQL via Prisma 6.13, two migrations checked in |
| Client | React 19, Vite 7, TanStack Query, Tailwind 4, shadcn/ui, react-hook-form, react-markdown |
| Tooling | Prettier, husky, lint-staged |

---

## Running it from scratch

**Prerequisites:** [Bun](https://bun.sh), a MySQL server, and a funded OpenAI API key.

**1. Install dependencies** — from the repository root, which installs both workspaces:

```bash
bun install
```

**2. Configure the server environment:**

```bash
cp packages/server/.env.example packages/server/.env
```

Then edit `packages/server/.env`:

- `OPENAI_API_KEY` — your key. Required, no fallback.
- `DATABASE_URL` — for example `mysql://root:password@localhost:3306/chatbot`
- `PORT` — optional, defaults to `3000`

**3. Create the database tables and generate the Prisma client:**

```bash
cd packages/server
bunx prisma migrate deploy
bunx prisma generate
```

`migrate deploy` applies both checked-in migrations and creates the `products`,
`reviews` and `summaries` tables. `generate` writes the typed client to
`packages/server/generated/prisma`, which the server imports at startup.

**4. Run both apps** — from the repository root:

```bash
bun run dev
```

Express starts on `http://localhost:3000` and Vite on `http://localhost:5173`.
Vite proxies `/api` to the server, so open the client URL and start chatting.

**To exercise the reviews API**, insert a product and a few reviews yourself —
`bunx prisma studio` is the quickest way — then call `GET /api/products/1/reviews`.

---

## Project structure

```text
.
├── index.ts                      # concurrently: runs server + client together
├── package.json                  # bun workspace root
└── packages/
    ├── server/
    │   ├── index.ts              # express bootstrap, loads history from disk
    │   ├── routes.ts             # route table
    │   ├── controllers/          # request/response + zod validation
    │   │   ├── chat.controller.ts
    │   │   └── review.controller.ts
    │   ├── services/
    │   │   ├── router.service.ts     # classify + dispatch + persist  <- the core
    │   │   ├── review.service.ts     # summarize with a 7-day cache
    │   │   ├── chat.service.ts
    │   │   └── apps/                 # one file per intent handler
    │   │       ├── weather.app.ts
    │   │       ├── math.app.ts
    │   │       ├── exchange.app.ts
    │   │       ├── general.app.ts
    │   │       └── reviewAnalyzer.app.ts
    │   ├── llm/client.ts         # the only place OpenAI is called
    │   ├── prompts/              # system prompts, kept out of the code paths
    │   ├── repositories/         # history (file) + product/review (Prisma)
    │   └── prisma/               # schema + 2 migrations
    └── client/
        └── src/
            ├── App.tsx
            ├── main.tsx
            └── components/
                ├── chat/         # ChatBot, ChatInput, ChatMessages, TypingIndicator
                ├── reviews/      # ReviewList, StarRating, ReviewSkeleton, reviewsApi
                └── ui/           # shadcn primitives
```

---

## Known limitations

Listed deliberately rather than quietly cleaned up. The trade-offs are worth
being explicit about:

- **Conversation history is a single JSON file.** Every message rewrites
  `history.json` in full, with no locking. Two concurrent users race each other,
  and a crash mid-write can truncate the file. It survives a restart; it does not
  survive a second process.
- **User input is concatenated into prompt templates.** There is no separation
  between system and user roles in the classifier and general-chat prompts, so
  the app is exposed to prompt injection.
- **No timeout, retry or rate-limit handling** around OpenAI calls. When the API
  fails, the user sees a generic `Something went wrong, try again!`.
- **`ReviewList` is never rendered.** The reviews UI was built and wired to the
  API, but `App.tsx` mounts only `<ChatBot />`. The component compiles and is dead.
- **`chat.service.ts`, `conversation.repository.ts` and `prompts/classifier.txt`
  are unreachable.** They are an earlier iteration that used the Responses API
  `previous_response_id` for server-side conversation state; the shipped path
  stuffs history into the prompt manually instead.
- **The guardrails are substring matching.** `checkGuardrails` blocks on keywords
  such as `government` or `party`, which produces false positives on innocent
  questions.
