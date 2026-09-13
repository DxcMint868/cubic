# Cubic demo — filming script (footage-by-footage)

Target cut: ~3:35 (within the 2–4 min window). No music. Voiceover only,
recorded separately per footage (VO txt lives next to this file, one per
footage: `vo-a.txt` … `vo-i.txt`).

The story is told through **Acme**, a fictional 120-person fintech (see
`docs/acme-tenant.md`): an AI workforce that ships code AND moves treasury
money, and the gateway that makes that insurable. Fiction is labeled; the
pipeline, identities, payments, and anchoring are real.

## Master edit sheet

| Footage | Screen | Seconds | Beat (PROJECT §17) | Prizes served |
|---|---|---|---|---|
| A | Landing page, top→bottom scroll (Cubic pitch) | 0:00–0:20 | 1 problem | story |
| A2 | Title card: "Imagine you're Acme" | 0:20–0:28 | 1 setup | story |
| B | Console → Agents | 0:28–0:48 | 2 cast | story |
| C | Chat: free-text PR read → ALLOW | 0:48–1:13 | 2 gateway | — |
| D | Chat: 402 → purchase → Payments → HashScan | 1:13–1:48 | 3–4 x402 | **Hedera** |
| E | Two-tab: merge → live approval → wallet sign → execution | 1:48–2:23 | 4–5 approvals | **Hedera** (HCS anchor of signature) |
| F | Chat: injected secret read + overbudget → DENY ×2 | 2:23–2:43 | 6 attack | story |
| G | lab-1 escalate → Graph playground + QuickNode page | 2:43–3:08 | 6 reputation | **The Graph** |
| H | Verify-on-HCS page → HashScan topic | 3:08–3:28 | 7 anchoring | **Hedera** |
| I | Network surface → closer | 3:28–3:43 | 7 network | story |

## Recording order (do it in this order, not edit order)

1. Pre-flight: reseed, top up operator HBAR, confirm `HCS_TOPIC_ID`,
   `OPENROUTER_API_KEY`, `APPROVER_PRIVATE_KEYS`, wallet connected in browser.
2. Make the A2 title card first (a plain PNG/slide, monochrome) so the edit
   has it ready.
3. Footage C, D, F (chat takes) — several takes each, keep the best.
4. Footage E (two-tab) — needs the chat take's merge escalation live; record
   both tabs in one screen capture.
5. Footage G (reputation) — live web, load pages BEFORE rolling.
6. Footage H (HCS verify) — right after E so signatures are fresh in the window.
7. Footage B, I (console + network) — anytime.
8. Footage A (landing scroll) — anytime; slowest scroll you can tolerate.

## On-screen rules (every footage)

- Monochrome UI is the brand — do not color-correct.
- Any mock/dev surface stays labeled on screen; VO says "simulated" where the
  label says mock.
- Real external surfaces (HashScan, Graph playground, QuickNode) get 3+ full
  seconds of stillness so a paused frame is readable.
- Cursor moves are slow and deliberate; every click is a sentence.

## Shot checklist per footage — see files vo-*.txt for narration.
