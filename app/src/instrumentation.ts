// Next.js startup hook (runs once per server instance, nodejs runtime only).
// plan-13 EXACT: under LEDGER_PROVIDER=ledger without a provisioned Key Ring,
// fail fast instead of serving a half-broken gateway that would fail
// opaquely per payment. Dev (default) boots untouched.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ledgerBootGate } = await import("./server/ledger/boot-gate");
  const gate = await ledgerBootGate();
  if (!gate.ok) process.exit(1);
}
