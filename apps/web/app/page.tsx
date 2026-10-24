import Link from "next/link";

export default function Home() {
  return (
    <main className="page stack">
      <section className="stack" style={{ gap: ".5rem", padding: "1.5rem 0" }}>
        <span className="badge">PayPal AI Hackathon 2026</span>
        <h1 style={{ fontSize: "2.2rem", maxWidth: "40rem" }}>
          AI agents are starting to shop. Sellers with only a photo feed are invisible to them.
        </h1>
        <p className="lead">
          AgentStall turns a seller&apos;s photos and captions into a store any AI shopping agent can find, question and pay
          through PayPal, and shows the seller what agents asked and why they didn&apos;t buy. The seller answers once;
          every future agent knows.
        </p>
      </section>

      <div className="grid-3">
        <Link href="/sell" className="card" style={{ textDecoration: "none" }}>
          <h2>1. Seller onboarding</h2>
          <p className="muted">Photo + caption in any language → AI drafts a checked listing → seller approves → PayPal Catalog product.</p>
        </Link>
        <Link href="/console" className="card" style={{ textDecoration: "none" }}>
          <h2>2. Watch an agent buy</h2>
          <p className="muted">An AI shopping agent searches the stall over MCP, asks the seller, and checks out with PayPal.</p>
        </Link>
        <Link href="/desk" className="card" style={{ textDecoration: "none" }}>
          <h2>3. Agent Desk</h2>
          <p className="muted">What agents asked, where they dropped off, and one-click answers that lift agent conversion.</p>
        </Link>
      </div>

      <section className="card">
        <h2>Connect your own agent</h2>
        <p className="muted">Any MCP client (Cursor, any MCP-capable agent, your own agent) can shop this stall:</p>
        <pre className="small" style={{ margin: 0, overflowX: "auto" }}>
          <code>MCP endpoint (streamable HTTP): {"<api-url>"}/mcp{"\n"}Tools: search_products, get_product, ask_seller, create_checkout, get_order_status</code>
        </pre>
      </section>
    </main>
  );
}
