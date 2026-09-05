---
"@lambdot/protocol-qq": patch
---

Reject a `QqMessageContext` with no addressing mode at runtime: an empty
context and a lone `msgSeq` (without `msgId`) now throw instead of falling
through to `is_wakeup: true`, keeping runtime behavior consistent with the
type-level contract.
