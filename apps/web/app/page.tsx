import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <section className="hero stagger">
        <span className="badge">PayPal AI Hackathon 2026</span>
        <h1>AI agents are starting to shop. Sellers with only an Instagram feed are invisible to them.</h1>
        <p className="lead">
          AgentStall turns a seller&apos;s posts into a stall that any AI shopping assistant can find, ask questions and pay
          through PayPal. The seller sees what the assistants asked, answers once, and every future shopper knows.
        </p>
        <div className="row" style={{ marginTop: ".5rem" }}>
          <Link href="/sell" className="btn primary big">
            🧺 I sell things
          </Link>
          <Link href="/shop" className="btn big">
            🛍️ I want to buy
          </Link>
        </div>
      </section>

      <section className="stack" style={{ marginTop: "1.5rem" }}>
        <h2>How it works</h2>
        <div className="grid-3 steps-row stagger">
          <div className="card">
            <h3>Bring your posts</h3>
            <p className="muted small">Connect Instagram or paste a caption in any language. AI writes a checked listing; you approve it.</p>
          </div>
          <div className="card">
            <h3>AI assistants shop</h3>
            <p className="muted small">Shoppers&apos; AI assistants search your stall, ask questions, and pay with PayPal after the buyer approves.</p>
          </div>
          <div className="card">
            <h3>Answer once</h3>
            <p className="muted small">See what assistants asked and why they left. One answer reaches every future shopper.</p>
          </div>
        </div>
      </section>

      <section className="grid-2" style={{ marginTop: "1.5rem" }}>
        <div className="card stack tight">
          <h2>Curious how it works inside?</h2>
          <p className="muted small">
            Switch on <b>⚙ Behind the scenes</b> at the top. Every page then shows each real step: the AI&apos;s prompt and
            checked answer, each tool call the shopping agent makes, and each PayPal API call and webhook.
          </p>
        </div>
        <div className="card stack tight">
          <h2>Bring your own AI agent</h2>
          <p className="muted small">Every stall is a public MCP server. Point any MCP-capable assistant at:</p>
          <div className="code">https://&lt;this-site&gt;/s/&lt;stall-id&gt;/mcp</div>
          <Link href="/stall" className="small">
            Find your stall&apos;s address on My Stall →
          </Link>
        </div>
      </section>
    </main>
  );
}
