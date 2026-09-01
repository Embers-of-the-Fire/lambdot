# websocket-bot

A self-verifying echo bot over a real websocket — the reference example for
lambdot's **connection-as-service** model: a websocket connection is an
ordinary plugin whose item map is the live socket interface.

```console
$ nub index.ts
driver received: echo: hello from driver
websocket-bot: OK
```

The example starts its own broadcast server in-process, applies the
composition against it, drives the bot with a raw client, and exits
non-zero if the round trip fails — it is its own integration test.

## What it demonstrates

1. **The connection is a service, not a stream.** `wsConnection(name)`
   (from `@lambdot/websocket`) owns the socket and nothing else: no message
   shapes, no codecs. It emits the live `WsConnection` — `{ url, push,
listen }` — as its item map, so feature plugins declare it as an
   ordinary input and receive it through the context. It is composed with
   `with`: hermetic, granted a blank context.
2. **The feature is the protocol.** `echo` subscribes with
   `socket.listen(...)` and replies with `socket.push(...)`. Whatever a
   frame means — decoding, addresses, reply routing — is feature code, not
   framework machinery. A concrete protocol (qq, discord, …) is a plugin
   written the same way.
3. **Config travels in `option`.** The connection's `{ url }` is its
   config, passed as `option` at the composition site — required exactly
   because the config type is non-void.
4. **Instances multiply by name.** Namespaces key on strings, so two
   `wsConnection` plugins compose side by side under distinct names, each
   feature wiring its own through its mapping — see `type-test.ts`, and
   [dual-websocket-bot](../dual-websocket-bot) for the runnable version.
   Reusing one name twice is a compile-time "duplicate namespace" error.
5. **Wiring order is a compile error.** Each `mapping`'s parameter is typed
   as the namespaces visible so far, and identity wiring fails when the
   declared input isn't among them. `type-test.ts` exercises all of it.

## The composition

```ts
const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(wsConnection("socket"), { option: { url } })
    // identity wiring: echo's input keys already match the visible ctx
    .use(echo);

const scope = createScope();
await app.apply(undefined, scope, undefined);
```

`apply` returns the root's own item map; the connection is input-side
scaffolding and does not propagate to the caller. When the scope disposes,
the listener detaches and the socket closes — teardown is the scope's LIFO
discipline, not a stop operation.

## File layout

| File           | Role                                                                |
| -------------- | ------------------------------------------------------------------- |
| `server.ts`    | Demo broadcast server standing in for a real chat service.          |
| `index.ts`     | Composition root: server, scope, raw-client round trip, self-check. |
| `type-test.ts` | Compile-time assertions for wiring through the connection plugin.   |

## Where next

- [dual-websocket-bot](../dual-websocket-bot) — two connections of this
  exact shape sharing one composition.
- [multi-bot](../multi-bot) — the same bot definition composed twice,
  nested under namespaces of a supervisor.
