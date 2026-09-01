# @lambdot/websocket

A websocket connection as an ordinary plugin. It owns the socket lifecycle —
connect, close on scope dispose — and nothing else: no message shapes, no
codecs, no protocol contract. The connection itself is the item map, an
interactive re-export to the context: consumers `listen` to incoming text
frames and `push` outgoing ones.

## What it provides

`wsConnection(name)` emits a `WsConnection` under `name`:

- `url` — the connected URL.
- `push(data)` — send a text frame.
- `listen(listener): Disposer` — subscribe to incoming text frames (binary
  frames are dropped); the disposer unsubscribes, and consumers register it
  on their scope.

The socket opens when the plugin applies — a connect failure fails the
application — and closes when the owning scope disposes. The name is a
parameter, so instances multiply: `wsConnection("a")` and
`wsConnection("b")` compose side by side, each consumer wiring its own
through its mapping.

## Usage

```ts
import { createScope, definePlugin } from "@lambdot/core";
import { wsConnection, type WsConnection } from "@lambdot/websocket";

const echo = definePlugin({
    name: "echo",
    apply(input: { socket: WsConnection }, scope) {
        scope.onDispose(input.socket.listen((data) => input.socket.push(`echo: ${data}`)));
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(wsConnection("socket"), { option: { url: "wss://example.test/ws" } })
    .use(echo);

const scope = createScope();
await app.apply({}, scope, undefined);
// ... later: await scope.dispose();
```

`wsConnection` is hermetic (`with`): a socket observes nothing of its
surroundings. Config beyond the URL — e.g. the `create` socket factory for
tests or hosts without a global `WebSocket` — rides the same `option`.

## API

- `wsConnection(name)` — a `Plugin<void, WsConnection, WsConnectionConfig, name>`.
- `WsConnection` — the connection service: `url`, `push(data)`,
  `listen(listener): Disposer`.
- `WsConnectionConfig` — `{ url, create? }`.
- `WebSocketLike` — the structural slice of the web-standard `WebSocket`
  the plugin drives; implement it to inject a fake or a platform socket.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
