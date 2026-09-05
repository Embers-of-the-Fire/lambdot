---
"@lambdot/console": minor
"@lambdot/core": minor
"@lambdot/env": minor
"@lambdot/host-cloudflare": minor
"@lambdot/host-hono": minor
"@lambdot/http": minor
"@lambdot/logging": minor
"@lambdot/protocol-qq": minor
"@lambdot/state-memory": minor
"@lambdot/state-sqlite": minor
"@lambdot/websocket": minor
---

Make `QqFileUpload` a union requiring an upload source: either `url` or
`uploadId` must be present (`{ fileType: 1 }` alone no longer type-checks),
and uploads reject a source-less object at runtime instead of sending a
request the platform is guaranteed to refuse.
