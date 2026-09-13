// Canonical approval-signing message (EIP-191 personal_sign). Pure module —
// safe to import from client components AND server routes. The browser wallet
// and the verifying route must sign/check identical bytes: change this and
// every outstanding approval invalidates (which is the point).
export function approvalSignMessage(approvalId: string, outcome: "approved" | "rejected"): string {
  return `Cubic approval\napproval: ${approvalId}\noutcome: ${outcome}`;
}
