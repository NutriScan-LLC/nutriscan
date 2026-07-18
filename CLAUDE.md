# Repository Rules

This repository implements the BioZoom VitalityCheck SDK. The canonical
protocol specification lives in `BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md`
at the repo root. Living documentation lives in `docs/protocol.md`
(confirmed behavior) and `docs/unknowns.md` (open questions).

## Rules

1. **Never guess protocol behavior.** If behavior is not confirmed against
   real hardware or explicitly documented in
   `BIOZOOM_PROTOCOL_AND_IMPLEMENTATION.md`, do not encode it as if it were
   known. Log it, test it, document it — in that order.

2. **Mark temporary assumptions `UNVERIFIED`.** Any assumption made to
   unblock implementation before hardware validation must be tagged with
   `UNVERIFIED` in a code comment and recorded in `docs/unknowns.md`. Remove
   the tag only after confirming the behavior.

3. **Update docs before changing confirmed protocol behavior.** If a change
   touches behavior already marked confirmed in `docs/protocol.md`, update
   that document as part of the same change, not after.

4. **Keep transport, protocol, and UI separate.**
   - `packages/biozoom-sdk/src/transport` — raw bytes only. No JSON parsing,
     no command knowledge, no BioZoom-specific framing.
   - `packages/biozoom-sdk/src/protocol` — command construction, response
     parsing, version detection, retries. No serial/browser APIs, no UI.
   - `packages/biozoom-sdk/src/scanner` — the public API surface UI code
     calls. UI (including `apps/scanner-test`) must never send raw serial
     commands directly or import from `transport`/`protocol` internals.

5. Never remove logging until behavior is fully understood.

6. Prefer clarity over cleverness.

7. Every protocol assumption should include an explanatory comment.
