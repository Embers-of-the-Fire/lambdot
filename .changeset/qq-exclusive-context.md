---
"@lambdot/protocol-qq": patch
---

Make `QqMessageContext` an exclusive union: the `msgId`, `eventId`, and
`wakeup` variants now exclude each other's fields at the type level
(`?: never`), and sends reject a context carrying conflicting fields at
runtime instead of silently dropping them.
