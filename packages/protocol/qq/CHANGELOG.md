# Changelog

## 0.4.0

### Minor Changes

- [#16](https://github.com/Embers-of-the-Fire/lambdot/pull/16) [`b874a1e`](https://github.com/Embers-of-the-Fire/lambdot/commit/b874a1e9251cffec3111a2a703cfc5d9cc47fd75) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Replace the message-bound QQ protocol with the full C2C/group infra, per the
  official documentation. **Breaking**: `QqAddress`, `QqMessageEvent.reply`,
  `decodeMessageEvent`, and the client's auto-incremented `msg_seq` state are
  gone. The webhook is now a pure listener (`onEvent`) decoding every C2C/group
  dispatch — message events (`C2C_MESSAGE_CREATE`, `GROUP_AT_MESSAGE_CREATE`,
  and full-mode `GROUP_MESSAGE_CREATE`, with author/attachments/mentions/scene),
  `INTERACTION_CREATE`, friend and group lifecycle/gate events, and group
  member/join-request events; guild-scene dispatches are dropped. Sending
  resolves from a caller-provided `QqMessageContext` (`{ msgId, msgSeq? }`,
  `{ eventId }`, `{ wakeup: true }`, or active) via
  `sendC2cMessage`/`sendGroupMessage`, which cover text/markdown/input-notify/
  rich-media payloads with keyboards and quote references and return the sent
  message's id. The client also gains `recallC2cMessage`/`recallGroupMessage`,
  `uploadC2cFile`/`uploadGroupFile`, and `ackInteraction`.

- [#16](https://github.com/Embers-of-the-Fire/lambdot/pull/16) [`b874a1e`](https://github.com/Embers-of-the-Fire/lambdot/commit/b874a1e9251cffec3111a2a703cfc5d9cc47fd75) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Make `QqFileUpload` a union requiring an upload source: either `url` or
  `uploadId` must be present (`{ fileType: 1 }` alone no longer type-checks),
  and uploads reject a source-less object at runtime instead of sending a
  request the platform is guaranteed to refuse.

### Patch Changes

- [#16](https://github.com/Embers-of-the-Fire/lambdot/pull/16) [`b874a1e`](https://github.com/Embers-of-the-Fire/lambdot/commit/b874a1e9251cffec3111a2a703cfc5d9cc47fd75) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Reject a `QqMessageContext` with no addressing mode at runtime: an empty
  context and a lone `msgSeq` (without `msgId`) now throw instead of falling
  through to `is_wakeup: true`, keeping runtime behavior consistent with the
  type-level contract.

- [#16](https://github.com/Embers-of-the-Fire/lambdot/pull/16) [`b874a1e`](https://github.com/Embers-of-the-Fire/lambdot/commit/b874a1e9251cffec3111a2a703cfc5d9cc47fd75) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Make `QqMessageContext` an exclusive union: the `msgId`, `eventId`, and
  `wakeup` variants now exclude each other's fields at the type level
  (`?: never`), and sends reject a context carrying conflicting fields at
  runtime instead of silently dropping them.

- [#16](https://github.com/Embers-of-the-Fire/lambdot/pull/16) [`b874a1e`](https://github.com/Embers-of-the-Fire/lambdot/commit/b874a1e9251cffec3111a2a703cfc5d9cc47fd75) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Send `/app/getAppAccessToken` to `https://bots.qq.com`, the host Tencent
  requires for token acquisition, instead of the OpenAPI host. The `apiBase`
  override still serves both API and token calls, so pointing at a mock in
  tests keeps working.

- [#16](https://github.com/Embers-of-the-Fire/lambdot/pull/16) [`b874a1e`](https://github.com/Embers-of-the-Fire/lambdot/commit/b874a1e9251cffec3111a2a703cfc5d9cc47fd75) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Reject `QqFileUpload` objects that carry both `url` and `uploadId` at runtime,
  matching the exclusive-source contract of the type. Previously a JavaScript
  caller or type cast could smuggle both fields into the upload request.
- Updated dependencies [[`b874a1e`](https://github.com/Embers-of-the-Fire/lambdot/commit/b874a1e9251cffec3111a2a703cfc5d9cc47fd75)]:
  - @lambdot/core@0.4.0
  - @lambdot/http@0.4.0

## 0.3.0

### Minor Changes

- [#14](https://github.com/Embers-of-the-Fire/lambdot/pull/14) [`0ff812b`](https://github.com/Embers-of-the-Fire/lambdot/commit/0ff812b0f1db909e859e6a1e7fad291108c0d60e) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Rearchitect the ecosystem per the specification: one concept (the plugin), one mechanism (context injection) in two forms — `use` grants a dependency the accumulated context (declaration order is observable), `with` grants it a blank context (hermetic; no mapping). A plugin's own logic runs last, over the final accumulated context, and produces the plugin's own item map, which never enters its own context; used as a dependency, the whole item map nests under one namespace of the parent's context. Plugins are immutable, stateless definitions; composition is non-destructive (`A.use(B)` / `A.with(B)` return new plugins and leave `A` unchanged). Application is caller-driven through an owned scope (`createScope` + `plugin.apply`); teardown unwinds LIFO through the scope, and failures mid-application dispose everything already applied in reverse before propagating. Config values are supplied per use site (`option`) and validated against Standard Schema validators. Diagnostics follow the abstract/handler pattern: plugins declare an optional sink in their input contract and emit only when one is wired in. Removes kernels, engines, composites, the `start`/`stop`/`ctx` lifecycle, `bind`/`expose`, background activation, and the message/state/stream utilities (concerns are ordinary plugins, not core).
  
  The sibling libraries are rebuilt on that model — a plugin's item map is a plain service interface; the old chat-platform machinery (address/message/command envelopes, message streams, input/output halves) is gone rather than translated:
  
  - `@lambdot/http`: the structural HTTP server contract (`HttpServer` — `on(method, path, handler)` answered with a web-standard `Response`, route parameters read through `c.req.param(name)`, everything else through `c.req.raw`). Anything able to register a route satisfies it; a hono app satisfies it directly. Protocol packages declare it as input; hosts hand their server in as an item map. Routes live as long as the server — there is no per-route disposal.
  - New `@lambdot/host-hono`: the host's hono app as the composition's HTTP surface — `httpHono` emits the `Hono` instance supplied as config, typed as the `HttpServer` contract. The host keeps full ownership beyond route registration: middleware, sub-routers, and `serve` stay on its own instance.
  - `@lambdot/console`: stdin/stdout processing, one service plugin (`consoleIo`) emitting `{ onLine(listener): Disposer, print(text, target?) }`.
  - `@lambdot/websocket`: one connection plugin (`wsConnection`) emitting an interactive re-export of the socket — `{ url, push(data), listen(listener): Disposer }`. The `WsSpec`/`wsInput`/`wsOutput`/`wsPlatform` bundle is removed.
  - `@lambdot/protocol-qq`: the QQ protocol is a webhook post handler composed on `@lambdot/http` — `qqWebhook` registers its callback route on the wired-in `HttpServer` (op-13 validation, ed25519 verification) and emits `{ onMessage(listener): Disposer }` with per-message `reply(content)`. The websocket gateway mode, the stream contracts, and the platform bundles are removed; `qqApi` (REST client) remains.
  - `@lambdot/logging`: drops the record-stream logger/sink pair — a sink is just a `Logger`, composed with plain functions (`loggerFrom` is now exported); `consoleLogger` remains.
  - `@lambdot/state-memory`: emits a plain `Map` (fresh per application) instead of implementing the removed `StateBackend` contract.
  - `@lambdot/host-cloudflare`: drops the `kvState`/`doState` `StateBackend` bridges (compose `kvNamespace` and read/write it directly); `doState` becomes `doStorage`, emitting the Durable Object's `storage` as-is; the websocket hub aligns with the connection vocabulary (`push`/`listen`).
  - `@lambdot/env`, `@lambdot/state-sqlite`: unchanged in behavior; documentation realigned with plugin-method composition.
  
  The examples are rebuilt on the same model: the qq gateway example is removed (the gateway mode is gone), `multi-kernel-bot` becomes `multi-bot` (one bot definition composed twice under a supervisor, per the nesting semantics), and every example composes services through `use`/`with` with a caller-owned scope.

### Patch Changes

- Updated dependencies [[`0ff812b`](https://github.com/Embers-of-the-Fire/lambdot/commit/0ff812b0f1db909e859e6a1e7fad291108c0d60e)]:
  - @lambdot/core@0.3.0
  - @lambdot/http@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`71e5732`](https://github.com/Embers-of-the-Fire/lambdot/commit/71e57321ad4ec7d1aef3651d104123f8167ec2e7), [`71e5732`](https://github.com/Embers-of-the-Fire/lambdot/commit/71e57321ad4ec7d1aef3651d104123f8167ec2e7)]:
  - @lambdot/core@0.2.0
  - @lambdot/websocket@0.2.0

## 0.1.1

### Patch Changes

- [#10](https://github.com/Embers-of-the-Fire/lambdot/pull/10) [`19d37e4`](https://github.com/Embers-of-the-Fire/lambdot/commit/19d37e42c7a5514fb62c8f31c65e1aa01916d355) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Switch inter-package dependency pins from exact versions to `workspace:*` so workspace members always resolve against local sources during development; pnpm rewrites the protocol to exact versions at pack/publish time.
- Updated dependencies [[`19d37e4`](https://github.com/Embers-of-the-Fire/lambdot/commit/19d37e42c7a5514fb62c8f31c65e1aa01916d355)]:
  - @lambdot/core@0.1.1
  - @lambdot/websocket@0.1.1

## [0.1.0](https://github.com/Embers-of-the-Fire/lambdot/compare/protocol-qq-v0.0.1...protocol-qq-v0.1.0) (2026-08-29)


### Features

* **protocol-qq:** qq protocol with gateway and webhook infras ([d41936b](https://github.com/Embers-of-the-Fire/lambdot/commit/d41936be964e620c6da5641aecfe5f370c2e541c))
