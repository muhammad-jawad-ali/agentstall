# AgentStall

> Working name. Make social-only sellers buyable by any AI shopping agent, paid through PayPal.

AgentStall turns a seller's product photos and captions into a store that any AI shopping agent can find, question and pay through PayPal. A seller dashboard shows what agents asked and why they didn't buy, and one answer from the seller teaches every future agent.

**Status:** early build. Without sandbox credentials the app runs on a mock PayPal gateway (see [docs/BUILD-WITHOUT-CREDENTIALS.md](docs/BUILD-WITHOUT-CREDENTIALS.md)).

## Repository layout

| Path | What it is |
|---|---|
| `packages/paypal` | `PayPalGateway` (sandbox + mock), Orders v2, webhook verification, agent attribution on `custom_id` |
| `apps/api` | Hono service: public MCP endpoint `/mcp` for buyer agents (`search_products`, `get_product`, `ask_seller`, `create_checkout`, `get_order_status`), verified `POST /webhooks/paypal`, checkout return, seller read API |
| `apps/web` | *(Day 2)* Seller onboarding and the AG Studio Agent Desk, forked from [paypaldev/hackathon-paypal-ag-grid-boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate) |
| `scripts/day1` | Sandbox verification checks (see [docs/DAY1.md](docs/DAY1.md)) |

## Quickstart

Requires Node 20+.

```bash
npm install
cp .env.example .env   # add your PayPal sandbox app credentials
npm test
npm run day1           # runs the sandbox checks
npm run dev:api        # http://localhost:8787/health
```

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
