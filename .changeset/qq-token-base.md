---
"@lambdot/protocol-qq": patch
---

Send `/app/getAppAccessToken` to `https://bots.qq.com`, the host Tencent
requires for token acquisition, instead of the OpenAPI host. The `apiBase`
override still serves both API and token calls, so pointing at a mock in
tests keeps working.
