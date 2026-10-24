# AgentStall

> Working name. Make social-only sellers buyable by any AI shopping agent, paid through PayPal.

AgentStall turns a seller's product photos and captions into a store that any AI shopping agent can find, question and pay through PayPal. A seller dashboard shows what agents asked and why they didn't buy, and one answer from the seller teaches every future agent.

**Status:** early build. Without sandbox credentials the app runs on a mock PayPal gateway (see [docs/BUILD-WITHOUT-CREDENTIALS.md](docs/BUILD-WITHOUT-CREDENTIALS.md)).

## Repository layout

| Path | What it is |
|---|---|
| `packages/paypal` | `PayPalGateway` (sandbox + mock), Orders v2, webhook verification, agent attribution on `custom_id` |
| `apps/api` | Hono service: public MCP endpoint `/mcp` for buyer agents (`search_products`, `get_product`, `ask_seller`, `create_checkout`, `get_order_status`), verified `POST /webhooks/paypal`, checkout return, seller read API |
| `apps/web` | Next.js app: seller onboarding (`/sell`), Agent Desk with AG Grid (`/desk`), hosted Buyer Agent Console (`/console`). Proxies `/api` to the API service |
| `demo-photos` | Openly licensed demo product photos and captions ([credits](demo-photos/CREDITS.md)) |
| `scripts/day1` | Sandbox verification checks (see [docs/DAY1.md](docs/DAY1.md)) |

## Quickstart

Requires Node 20+.

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY (free at aistudio.google.com); PayPal credentials optional, mock mode without them
npm test
npm run dev:api        # API + MCP endpoint on http://localhost:8787
npm run dev:web        # web app on http://localhost:3000 (second terminal)
npm run day1           # PayPal sandbox checks, once credentials are in .env
```

## Connect your own agent

Any MCP-capable AI tool can shop a stall: see [docs/CONNECT-AN-AGENT.md](docs/CONNECT-AN-AGENT.md).

## PayPal surfaces

| Surface | Used for |
|---|---|
| Orders v2 (create, capture, direct-card) | Agent checkout; buying agent recorded in `custom_id` |
| Webhooks + verify-webhook-signature | Live order confirmation |
| Agent Toolkit (`@paypal/agent-toolkit`) | Catalog products, shipment tracking, refunds |
| Remote MCP server (`mcp.sandbox.paypal.com`) | Optional route for dashboard-agent PayPal tools |
| Transaction search | Dashboard enrichment |

## License

[MIT](LICENSE)
