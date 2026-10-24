# Building without PayPal credentials

Until a teammate in a PayPal-supported country joins and shares **sandbox** credentials, AgentStall runs on a **mock PayPal gateway**. Everything else gets built for real. Getting credentials should then mean pasting three values into `.env`, re-running `npm run day1`, and redeploying.

## How the switch works

All PayPal calls go through one `PayPalGateway` interface (`packages/paypal/src/gateway.ts`):

| | Mock (now) | Sandbox (after credentials) |
|---|---|---|
| Chosen when | `PAYPAL_CLIENT_ID` is empty, or `PAYPAL_MODE=mock` | `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` set |
| Orders v2 | In-memory orders shaped like PayPal's JSON | Real sandbox orders |
| Buyer approval | Local `/mock-paypal/approve/:id` page | `sandbox.paypal.com` approval |
| `PAYMENT.CAPTURE.COMPLETED` | Emitted in-process after a short delay | Verified webhook from PayPal |
| Catalog / tracking / refunds | In-memory | Agent Toolkit + REST |

Everything above the gateway (the MCP server, order state, the dashboard, the agents) stays the same in both modes. The mock **never** reaches the video or the submission; the UI shows a "MOCK PAYPAL" badge whenever it's active.

## Order of work (solo schedule)

| Dates (PKT) | Build | Needs from you |
|---|---|---|
| 24 Oct | Mock gateway, store with seeded demo seller, public MCP server (search, ask, checkout, order status) | Nothing |
| 25–26 Oct | Listing extractor (photo + caption → validated listing), seller-facts "stall-keeper" agent | **AI API key** |
| 27–28 Oct | Buyer Agent Console + persona batch runner | AI key |
| 29–30 Oct | Seller onboarding UI (`apps/web`), deploy to Render | **Render account** (free signup), GitHub push OK |
| 31 Oct–3 Nov | AG Studio Agent Desk: theme, Agent Funnel + Unanswered Questions widgets, Funnel Analyst agent | Start the AG Studio trial on 31 Oct |
| 4–5 Nov | Unhappy paths, tests, README, architecture diagram | Nothing |
| **By 5 Nov at the latest** | **Swap to sandbox**: `.env` → `npm run day1` → webhook on Render → re-run golden path | **Teammate's sandbox credentials** |
| 6–11 Nov | Freeze, film, submit (see master plan) | You record the voiceover |

## The credentials deadline

The video and the judged demo **must** use the real sandbox. A mock can't pass Stage One ("PayPal must be central"). Swapping takes about half a day if nothing surprises us, so:

- **Target:** teammate with credentials by **1 Nov**.
- **Hard stop:** **5 Nov**. After that there's no time to film on real sandbox.

## What the teammate needs to do (about 15 minutes)

1. Sign up at developer.paypal.com with their own real details.
2. Apps & Credentials → **Sandbox** → Create App. In the app's Features, turn on **Transaction search**.
3. Sandbox → Accounts: note the default **personal** test account's email and password (judges use it to approve payments).
4. Send you the sandbox **Client ID**, **Secret** and the personal test-account login over a private channel. Sandbox credentials can't move real money, but still keep them out of the repo.
5. Later, register the webhook URL you give them (or share dashboard access) and send back the **Webhook ID**.

They also need to join your Devpost team so the submission is legitimate.
