# Day-1 checklist

Numbers match the master plan's Day-1 table. ✅ = done in the repo already.

## You do these by hand (in order)

| # | Step | How |
|---|---|---|
| 1 | **Sign up at developer.paypal.com with your real details** | If Pakistan is blocked, do **not** use a VPN or a fake country. Post on the Devpost forum / PayPal Discord asking for the sanctioned route, or a teammate in a supported country owns the account and shares sandbox app credentials |
| 2a | Create a sandbox REST app | Dashboard → Apps & Credentials → Sandbox → Create App. Copy Client ID + Secret into `openstall/.env` |
| 2b | Enable **Transaction search** on the app | App settings → Features (needed for check #5) |
| 10a | *(Optional)* Create a second sandbox **Business** account | Dashboard → Sandbox → Accounts. Put its email in `PAYPAL_SECOND_MERCHANT_EMAIL` |
| 11 | Confirm the seller persona's market can receive PayPal | paypal.com/webapps/mpp/country-worldwide. If Malaysia/Philippines/Indonesia is unclear, switch the persona to a US/UK maker |
| 12 | **Decide the name.** "OpenStall" collides with **openstall.ai** (a live AI-agent marketplace, GitHub org `openstall-ai`) | Pick a new name before the repo goes public |
| 14 | Pick the AI provider and set a hard monthly spend cap | Put the key in `AI_API_KEY` |
| 15 | Join the PayPal Discord; install the PayPal AI-Toolkit and APIMatic Context plugins in your coding agent | `npx context-plugins install paypal` |

## The script does these (`npm run day1`)

| # | Check | Pass looks like |
|---|---|---|
| 2 | OAuth token | token returned from `api-m.sandbox.paypal.com` |
| 3 | Direct-card order | `COMPLETED` with no login |
| 4 | Approve-link order | prints a link: log in as your sandbox **personal** account, approve, then `npm run day1:capture -- <ORDER_ID>` |
| 5 | Transaction search | returns a count (new payments can take hours to show) |
| 6 | Agent Toolkit `create_product` / `list_products` | product created in sandbox |
| 7 | Remote MCP server | tool list, plus whether `commerce:true` adds shopping tools |
| 10 | Payee routing | order paid to the second business account |

Paste the "Day-1 results" block back into the chat and the failures get fixed from there.

## Done in the repo

- ✅ 13: MIT license, `.env.example`, `.gitignore` for secrets, GitHub Actions CI (typecheck + tests), CONTRIBUTING
- ✅ Webhook endpoint with signature verification (`apps/api`), ready for check #8
- ✅ `render.yaml` for check #8 (always-on instance)

## Still to do after the repo is on GitHub

| # | Step |
|---|---|
| 8 | Deploy `apps/api` to Render, register `https://<app>.onrender.com/webhooks/paypal` on the sandbox app (event `PAYMENT.CAPTURE.COMPLETED`), put the webhook ID in Render env, run check #3 again, and time how long the verified event takes to appear in the Render logs |
| 9 | Clone the AG Grid boilerplate into `apps/web` and check whether AG Studio runs without a license key. **Don't start the 45-day trial before 31 Oct** |
| 13 | After the first push: confirm the license shows in the GitHub About box, then turn on secret scanning and branch protection |
