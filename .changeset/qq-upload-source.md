---
"@lambdot/protocol-qq": patch
---

Make `QqFileUpload` a union requiring an upload source: either `url` or
`uploadId` must be present (`{ fileType: 1 }` alone no longer type-checks),
and uploads reject a source-less object at runtime instead of sending a
request the platform is guaranteed to refuse.
