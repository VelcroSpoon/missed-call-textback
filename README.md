# Missed Call Text-Back

Multi-tenant SaaS that texts back the people a small business misses on the
phone. One deployment serves many businesses; each has its own Twilio number,
message template, settings, and call log.

- **Next.js 15** (App Router) on **Vercel**
- **Supabase Postgres** via **Drizzle ORM**
- **Twilio** Programmable Voice + Messaging + Lookup
- **Tailwind + shadcn/ui** dashboard, **Supabase Auth** magic links

Message bodies are static templates. There is no LLM anywhere in the send path,
by design — a text that goes out unsupervised to a stranger's phone should be
something a human wrote and can predict.

---

## How a call flows

```
Caller ──dials──▶ Business line ──carrier forwards──▶ Twilio number
                                                          │
                                    POST /api/voice/[clientId]
                                                          │
                                     TwiML: <Dial timeout=20
                                              action=/api/voice/status/[clientId]>
                                                          │
                                        ┌─────────────────┴─────────────────┐
                                  answered                            no-answer / busy / failed
                                        │                                   │
                                   (nothing)                    POST /api/voice/status/[clientId]
                                                                            │
                                                          insert call row (unique on CallSid)
                                                                            │
                                                          opted out? ──▶ log, suppressed
                                                          quiet hours? ─▶ log, suppressed
                                                          landline? ────▶ log, suppressed
                                                                            │
                                                                 send SMS from the Twilio number
                                                                            │
                                              caller replies ──▶ POST /api/sms/incoming/[clientId]
                                                                 (logged, attributed to the call)
```

### Routes

| Route | Purpose |
| --- | --- |
| `POST /api/voice/[clientId]` | Voice webhook. Returns TwiML that dials `business_phone` with the client's timeout, an `action` URL, and a per-leg `statusCallback`. |
| `POST /api/voice/status/[clientId]` | `<Dial>` action callback. Writes the call row and decides whether to text. Also receives per-leg status events (`?src=child`), which are logged only. |
| `POST /api/sms/incoming/[clientId]` | Messaging webhook. Logs every inbound message; `STOP`/`STOPALL`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT` write an opt-out, `START`/`UNSTOP` remove it. |
| `POST /api/sms/status` | Delivery status callback. Updates `messages.status` and `messages.error_code`. |

---

## The guarantees, and how they are enforced

**Signature validation.** `verifyTwilioRequest` in
[src/lib/twilio-signature.ts](src/lib/twilio-signature.ts) is the first
statement in every webhook, before any database access. It reads the raw body
with `req.text()` (Vercel gives no raw-body helper, and `req.formData()` would
consume the stream), parses it into the parameter map Twilio signed, and checks
the `X-Twilio-Signature` HMAC. Invalid or missing → `403`, nothing written.

Because Vercel's proxy rewrites `req.url`, the signed URL is rebuilt from
`APP_URL` first, then from `x-forwarded-host`, then from `req.url`; the request
is accepted if any candidate validates. **`APP_URL` must match the URL
configured on the Twilio number exactly**, or every webhook will 403.

**Idempotency.** Twilio retries callbacks. `calls.twilio_call_sid` carries a
unique index, and the status route's only write path is
`INSERT … ON CONFLICT DO NOTHING … RETURNING`. The first delivery gets a row
back and proceeds; every retry gets `null` and returns without sending. Two
concurrent retries cannot both win, because the decision is the insert itself.
Per-leg `statusCallback` events deliberately never insert, so they cannot
consume the key before the real action callback arrives.

**Opt-outs.** Checked before anything else, per client. An opt-out for one
tenant does not affect another. Test sends from the dashboard honour it too.

**Quiet hours.** Per-client window in the client's own timezone, default
21:00–08:00, evaluated with `Intl` (see [src/lib/quiet-hours.ts](src/lib/quiet-hours.ts)).
The window may wrap midnight. Suppressed calls are logged as missed with
`suppressed = true` and `suppression_reason = 'quiet_hours'` — **nothing is
queued for later**. A 2am call answered by a 2am text is worse than silence, and
a morning batch of texts about last night's calls is worse still.

A broken configuration (unknown timezone, unparseable time, start == end) fails
*open*: the client keeps getting texts. Silently muting a paying customer is the
worse failure.

**Landlines.** Twilio Lookup (`line_type_intelligence`) is consulted before
sending, and the result is cached in `phone_lookups` for 180 days — line types
effectively never change and each lookup is billed. Only `landline` and `pager`
block the send; VoIP numbers receive SMS fine and are allowed through. A Lookup
error fails open (send anyway) rather than dropping a lead.

**Opt-out notice.** `buildMessageBody` appends `Reply STOP to opt out.` to every
outbound message unless it is already present. This happens at send time, not at
save time, so an old row, a seeded template, or a direct database edit cannot
produce a non-compliant message.

**Secrets and PII.** All Twilio credentials come from env vars. The logger
([src/lib/logger.ts](src/lib/logger.ts)) redacts any key matching
`token|password|secret|api_key|signature` outright, and redacts phone-number
values to `+1555***4567` at every level.

---

## Data model

Tables: `clients`, `templates`, `calls`, `messages`, `opt_outs`, `users`, plus
`phone_lookups` (the Lookup cache).

Indexes as specified: `calls (client_id, created_at)`, `calls (twilio_call_sid)`
unique, `opt_outs (client_id, phone_number)` unique.

Three columns exist beyond the original spec, all load-bearing:

- `clients.quiet_hours_enabled / _start / _end` — the quiet-hours window has to
  live somewhere per-tenant.
- `calls.suppressed` + `calls.suppression_reason` — the requirement to "log the
  call as missed with a suppressed flag" needs both the flag and the why.
- `calls.sms_sent` — separates "we texted and they ignored us" from "we never
  texted", which is what makes the recovery rate honest.

---

## Setup

### 1. Database

```bash
cp .env.example .env
```

Fill in `DATABASE_URL` from Supabase → Project Settings → Database → Connection
string → URI. On Vercel use the pooler (port 6543); `prepare: false` is already
set for pgbouncer compatibility.

```bash
npm install
npm run db:migrate
```

`drizzle/0000_init.sql` is hand-authored to match `src/db/schema.ts` exactly and
is idempotent (`IF NOT EXISTS` throughout), so it is safe to re-run.

> Note on future migrations: `drizzle/meta/` ships with a journal but no
> snapshot, so `drizzle-kit generate` cannot diff against migration 0000 yet.
> For local iteration use `npm run db:push`. When you are ready to author
> migration 0001 properly, run `npx drizzle-kit generate` once against the
> unchanged schema and keep the snapshot it writes — from then on `generate`
> produces normal incremental migrations.

Everything is reached through the Postgres connection string with Drizzle, not
through PostgREST, so Supabase RLS is not in the request path. The tenancy
boundary is `requireSession()` in [src/server/auth.ts](src/server/auth.ts):
every page and action resolves the logged-in user to their own `client_id`, and
no `client_id` is ever read from a URL or a form field.

### 2. Supabase Auth

Enable **Email** as a provider with magic links. Under Authentication → URL
Configuration add these redirect URLs:

```
http://localhost:3000/auth/callback
https://your-app.vercel.app/auth/callback
https://YOUR-NGROK-SUBDOMAIN.ngrok-free.app/auth/callback
```

Sign-up is closed (`shouldCreateUser: false`). Accounts are created by an owner
from `/admin`, which sends a Supabase invite and writes the `users` row bound to
one client.

### 3. Seed a demo client

Fill the `SEED_*` values in `.env`, then:

```bash
npm run seed
```

It creates (or updates) one client with a default template and prints the exact
webhook URLs to paste into Twilio. Re-running is safe.

To get yourself into the dashboard: set `SEED_OWNER_EMAIL`, run the seed, then
invite that address from Supabase → Authentication → Users → Invite. The first
sign-in binds your Supabase auth id to the seeded `users` row.

### 4. Twilio number setup

Buy a number (Console → Phone Numbers → Buy a number) with **Voice** and **SMS**
enabled, then configure it:

| Field | Value |
| --- | --- |
| A CALL COMES IN | Webhook, `POST`, `https://YOUR_APP_URL/api/voice/<clientId>` |
| A MESSAGE COMES IN | Webhook, `POST`, `https://YOUR_APP_URL/api/sms/incoming/<clientId>` |

Or skip all of that: as an owner, go to `/admin`, create the client with the
tracking number left blank, and click **Provision**. That searches for an
available local number in the area code you give, buys it, and sets both webhook
URLs on it in the same API call. **Sync webhooks** re-points an existing number
at the current `APP_URL` — run it after changing domains.

Set the SMS delivery status callback to `https://YOUR_APP_URL/api/sms/status`.
This is passed per-message by the app, so there is nothing to configure in the
console.

---

## Call forwarding: what to tell the business owner

This is the part that has to be explained over the phone, so keep it short.

> "Your phone will still ring normally. We are only catching the calls you don't
> pick up. Dial this code from your business phone and you're done."

**Conditional forwarding is what you want** — forward only on no-answer/busy, so
the business's own phone rings first and we only see the calls they actually
missed.

**The codes vary by carrier and country.** There is no universal one. On many
North American mobile carriers the pattern is:

| Situation | Typical code |
| --- | --- |
| Forward when unanswered | `*61*<twilio number>#` then call |
| Forward when busy | `*67*<twilio number>#` then call |
| Forward when unreachable | `*62*<twilio number>#` then call |
| Cancel all conditional forwarding | `##004#` then call |

On other carriers the same actions are `*71`, `*72`, `*73`, or are only
available in the carrier's app or web portal, and some VoIP/landline providers
(RingCentral, Ooma, Comcast Business, most PBXs) expose it as a setting called
"forward on no answer" with a ring-count instead of a code.

**Tell the owner to confirm the code with their carrier** rather than guessing —
dialling the wrong one can forward *all* calls unconditionally, which sends
every customer straight to us instead of to them.

Two things to check after setup:

1. **Ring count.** Set the carrier's "forward after N rings" below the point
   where carrier voicemail answers. If voicemail picks up first, the call is
   answered from Twilio's point of view and never counts as missed.
2. **Dial timeout.** Our `dial_timeout_seconds` (default 20s, in Settings) is how
   long *we* let the business's line ring before declaring it missed. Keep it
   under their voicemail pickup for the same reason.

---

## A2P 10DLC registration

US carriers filter unregistered application-to-person traffic on long codes.
Without registration your messages will be heavily filtered or blocked outright,
and this product is entirely application-to-person. Do this before onboarding
real clients.

In Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC:

1. **Create a Primary Customer Profile** for your own business (legal name, EIN,
   address, website, an authorised representative). Expect a day or two.
2. **Register a Brand.** For a US company this is a Standard brand; sole
   proprietors have a separate, lower-throughput path.
3. **Create a Campaign.** For this product the use case is
   **Customer Care** (or Conversational). What the reviewer looks for:
   - **Sample messages** that match what you actually send. Paste the real
     rendered template, opt-out sentence included.
   - **Opt-in description.** Yours is: *the end user called the business and did
     not reach them; the business replies by text to the number that called.*
     Say that plainly, and say where it is disclosed (your client's website
     privacy/terms page, and their on-hold or voicemail greeting if any).
   - **Opt-out handling.** Point at the `STOP` keyword support and the notice
     appended to every message.
4. **Create a Messaging Service**, add your numbers to its sender pool, and link
   it to the campaign. Put its SID in `TWILIO_MESSAGING_SERVICE_SID`.

The app passes both `from` (the tenant's own number) and `messagingServiceSid`
to Twilio, so the caller always sees the number they dialled while the message
still gets the campaign's registration. Do not let the service pick a sender
from its pool — in a multi-tenant deployment that would text a caller from some
other business's number.

If you enable Twilio's **Advanced Opt-Out** on the Messaging Service, the
carrier-level filter may swallow `STOP` before our webhook fires. We keep our
own `opt_outs` row whenever we do see it, so suppression never depends on
Twilio's copy of that state — but be aware the two can diverge, and Twilio's
copy is the one that legally blocks the send.

Throughput is per-campaign and low to start (often 1 message/second for a
sole-proprietor brand). Fine for missed calls; something to watch if you add
bulk sends later.

---

## Local development with ngrok

Twilio has to reach your machine, and it must reach it over the same hostname it
signs with.

```bash
ngrok http 3000
```

Copy the `https://` forwarding URL into `.env`:

```
APP_URL=https://your-subdomain.ngrok-free.app
```

`APP_URL` is not cosmetic. It is the URL used to verify every signature and to
build the `statusCallback` on each outbound message. If it does not match what
Twilio requested, every webhook returns 403.

Then:

```bash
npm run dev
npm run seed        # prints the two URLs to paste into the Twilio console
```

Point the number's voice and messaging webhooks at the ngrok URLs, call the
Twilio number from your mobile, let it ring past the timeout, and hang up. You
should get the text within a few seconds.

A free ngrok URL changes on every restart. When it does, update `APP_URL`,
restart the dev server, and re-point the number (`/admin` → **Sync webhooks**
does this for you).

Testing at 11pm and getting nothing? That is quiet hours working. Either widen
the window in Settings or turn it off while testing.

If you need to bypass signature validation for a moment — replaying a captured
request with `curl`, say — set `TWILIO_SKIP_SIGNATURE_VALIDATION=true`. It is
hard-disabled whenever `NODE_ENV=production`, so it cannot be turned on by
accident on a live deployment. Every skipped check logs a warning.

---

## Deploying to Vercel

1. Import the repo, framework preset Next.js.
2. Add every variable from `.env.example` to the project's environment.
   `APP_URL` must be the production domain, no trailing slash.
3. Deploy, then run `npm run db:migrate` against the production database.
4. `/admin` → **Sync webhooks** on every client, so their numbers point at the
   production URLs.

Webhook routes are `runtime = "nodejs"` (the Twilio SDK and `postgres` need it)
and `dynamic = "force-dynamic"`. The auth middleware explicitly excludes
`/api/*` — session refresh must never touch a Twilio webhook.

---

## Dashboard

`/dashboard` — auth-gated, scoped to the logged-in user's client.

- Missed calls this month, last month, and the percent change (month boundaries
  computed in the client's timezone, not the server's)
- Recovery rate: of the missed calls where we actually sent a text, the share
  that got a reply. Suppressed calls are excluded from the denominator —
  counting a quiet-hours suppression as a failed recovery would understate the
  product.
- Recent missed calls: time, caller, outcome, whether the text went out (with
  the suppression reason when it did not), whether they replied
- `/dashboard/templates` — editor with live preview, segment/encoding count, and
  a "send test to my phone" button
- `/dashboard/settings` — dial timeout, quiet hours, business phone, timezone

`/admin` — `role = owner` only. List clients, add a client, provision a number,
sync webhooks, pause a client, invite users.

---

## Tests

```bash
npm test
```

Covers the four things that cost real money or real trust when they break:

- **Signature validation** — forged signature, missing header, and a valid
  signature replayed against a tampered body are all rejected with 403 and zero
  writes; a correctly signed request is accepted; enforcement is asserted on all
  four webhooks.
- **Idempotency** — three deliveries of the same `CallSid` produce exactly one
  SMS; a different `CallSid` still sends; per-leg callbacks never create a row;
  an answered call sends nothing.
- **Opt-out suppression** — an opted-out caller is never texted, the check runs
  before the billable Lookup, the call is still logged as missed, and the
  inbound keyword handling writes and clears opt-outs.
- **Quiet hours** — wrapping windows, boundary inclusivity, DST, client
  timezone vs server timezone, fail-open on bad config, and route-level
  suppression that logs the call without queueing anything.

Plus landline suppression, Lookup cache behaviour, template rendering, and the
opt-out notice.

The webhook tests mock `@/server/repo` and `@/lib/twilio`, so they exercise the
real route handlers, the real signature validation, and the real suppression
logic without a database or a Twilio account. Signatures in the tests are
computed from Twilio's documented HMAC-SHA1 algorithm rather than with the
library under test.

```bash
npm run typecheck   # tsc --noEmit
npm run build       # next build
```

---

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run db:migrate` | Apply `drizzle/` migrations |
| `npm run db:push` | Push schema directly (dev only) |
| `npm run db:studio` | Drizzle Studio |
| `npm run seed` | Create/update the demo client |
