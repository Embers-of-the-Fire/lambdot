---
"@lambdot/console": major
"@lambdot/core": major
"@lambdot/env": major
"@lambdot/host-cloudflare": major
"@lambdot/host-hono": major
"@lambdot/http": major
"@lambdot/logging": major
"@lambdot/protocol-qq": major
"@lambdot/state-memory": major
"@lambdot/state-sqlite": major
"@lambdot/websocket": major
---

Rearchitect the ecosystem per the specification: one concept (the plugin), one mechanism (context injection) in two forms — `use` grants a dependency the accumulated context (declaration order is observable), `with` grants it a blank context (hermetic; no mapping). A plugin's own logic runs last, over the final accumulated context, and produces the plugin's own item map, which never enters its own context; used as a dependency, the whole item map nests under one namespace of the parent's context. Plugins are immutable, stateless definitions; composition is non-destructive (`A.use(B)` / `A.with(B)` return new plugins and leave `A` unchanged). Application is caller-driven through an owned scope (`createScope` + `plugin.apply`); teardown unwinds LIFO through the scope, and failures mid-application dispose everything already applied in reverse before propagating. Config values are supplied per use site (`option`) and validated against Standard Schema validators. Diagnostics follow the abstract/handler pattern: plugins declare an optional sink in their input contract and emit only when one is wired in. Removes kernels, engines, composites, the `start`/`stop`/`ctx` lifecycle, `bind`/`expose`, background activation, and the message/state/stream utilities (concerns are ordinary plugins, not core).

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
