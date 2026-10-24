/** Captures an order after the sandbox buyer approved it: `npm run day1:capture -- <ORDER_ID>`. */
import { PayPalError, captureOrder, clientFromEnv } from "@openstall/paypal";

const orderId = process.argv[2];
if (!orderId) {
  console.error("usage: npm run day1:capture -- <ORDER_ID>");
  process.exit(1);
}

try {
  const order = await captureOrder(clientFromEnv(), orderId);
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  console.log(`#4 approve-link order ${order.id}: ${order.status} (capture ${capture?.id ?? "none"})`);
  process.exit(order.status === "COMPLETED" ? 0 : 1);
} catch (err) {
  const debug = err instanceof PayPalError && err.debugId ? ` [debug id ${err.debugId}]` : "";
  console.error(`capture failed: ${err instanceof Error ? err.message : err}${debug}`);
  process.exit(1);
}
