# Connect your own AI agent to a stall

Every AgentStall store is a public [MCP](https://modelcontextprotocol.io) server. Any MCP-capable AI tool (coding assistants, desktop chat apps, agent frameworks) can search it, ask the seller questions and check out with PayPal.

## Endpoint

| | |
|---|---|
| URL | `http://localhost:8787/mcp` locally, or `https://<your-api-host>/mcp` when hosted |
| Transport | Streamable HTTP |
| Auth | None (the buyer approves every payment inside PayPal) |

## Tools

| Tool | What it does |
|---|---|
| `search_products` | Search by text, max price (USD) and destination country |
| `get_product` | Full details plus shipping and returns policies |
| `ask_seller` | Ask anything. Answers come only from what the seller confirmed; `unknown` means not answered yet, so don't guess |
| `create_checkout` | Creates a PayPal order and returns `approveUrl`; `payment_method: "sandbox_test_card"` pays instantly in sandbox demos |
| `get_order_status` | Whether PayPal has captured the payment |

## Add it to your tool

Most MCP clients accept a JSON config like this. For example, in Cursor put it in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "agentstall": {
      "url": "http://localhost:8787/mcp"
    }
  }
}
```

Command-line agents usually have an "add MCP server" command that takes a name, the transport (`http`) and the URL. Check your tool's docs for the exact syntax.

Then ask your agent something like:

> Using the agentstall tools, find a hand-dyed blue scarf under $40 that ships to the US, ask the seller about customs duties, and if that's answered, create a checkout.

## Attribution

The MCP client name your tool sends during `initialize` is recorded on the PayPal order (`custom_id = agent:<client-name>:<session>`) and shown in the seller's Agent Desk. It's self-declared, so treat it as attribution, not verified identity.

## Try it without an AI tool

```bash
npx @modelcontextprotocol/inspector
```

Choose "Streamable HTTP", enter the endpoint URL and call the tools by hand.
