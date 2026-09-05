---
"@lambdot/protocol-qq": minor
---

Abstract the QQ access-token cache behind `QqTokenStore`: an async-capable
`{ get, set }` pair over `{ token, expiresAt }`. `createQqApi` accepts it as
the new `tokenStore` option, and the `qqApi` plugin declares it as an
optional input, so any state backend — a `@lambdot/state-memory` map,
SQLite, a KV namespace — can be wired in through the composition mapping to
share one token across client instances or persist it across restarts.
Without a store the client keeps its previous behavior: a private in-memory
cache refreshed ahead of expiry, with single-flight fetch deduplication.
