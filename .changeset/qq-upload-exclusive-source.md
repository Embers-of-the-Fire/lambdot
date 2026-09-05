---
"@lambdot/protocol-qq": patch
---

Reject `QqFileUpload` objects that carry both `url` and `uploadId` at runtime,
matching the exclusive-source contract of the type. Previously a JavaScript
caller or type cast could smuggle both fields into the upload request.
