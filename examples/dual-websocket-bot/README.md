# dual-websocket-bot

Two websocket connections, **one composition** — the shared-instance story
of the lambdot design. Both connections are the same `wsConnection` plugin
from `@lambdot/websocket`, instantiated twice under distinct names, so one
echo feature serves both sockets while the mapping types keep every wire
compile-time checked.

```console
$ nub index.ts
[a] hello from driver A
[b] hello from driver B
driver A received: echo(a): hello from driver A
driver B received: echo(b): hello from driver B
dual-websocket-bot: OK
```

The example starts two broadcast servers in-process (ports 8080/8081),
applies one composition against both, drives each connection with a raw
client concurrently, and exits non-zero if any reply arrives on the wrong
socket — it is its own integration test.

## What it demonstrates

1. **One composition, two named instances.** `wsConnection("socket-a")` and
   `wsConnection("socket-b")` declare the same service shape twice. The
   namespaces sit side by side in the context, and the feature declares
   both as its input. Reusing one name twice is a compile-time "duplicate
   namespace" error.
2. **Identity is the namespace, not a tag.** The two sockets are
   distinguished by the context keys the feature reads — there is no
   platform tag inside a shared envelope to route on. Same-name instances
   are simply impossible: the type system rejects them.
3. **Replies travel with the subscription.** The feature subscribes to each
   connection separately; each listener's closure pushes its reply through
   the socket it subscribed to. No merged stream, no filter — the reply
   channel is lexical.
4. **Sharing is declaring.** Both namespaces live in one context, so one
   feature (or several) can tap both services without any bridging. That is
   the point of sharing a composition; if you want nesting and isolation
   instead, see [multi-bot](../multi-bot).

## The composition

```ts
const echo = definePlugin({
    name: "echo",
    apply(input: { "socket-a": WsConnection; "socket-b": WsConnection }, scope) {
        scope.onDispose(
            input["socket-a"].listen((data) => input["socket-a"].push(`echo(a): ${data}`)),
        );
        scope.onDispose(
            input["socket-b"].listen((data) => input["socket-b"].push(`echo(b): ${data}`)),
        );
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(wsConnection("socket-a"), { option: { url: urlA } })
    .with(wsConnection("socket-b"), { option: { url: urlB } })
    .use(echo);
```

## File layout

| File        | Role                                                                |
| ----------- | ------------------------------------------------------------------- |
| `server.ts` | Demo broadcast server standing in for a real chat service.          |
| `index.ts`  | Boots the composition, drives both sockets, verifies no cross-talk. |

## When to choose this over nested compositions

- **One composition, named instances** (this example): the services are
  genuinely one bot — shared features reading both namespaces, one scope
  owning both sockets.
- **Nested** (`multi-bot`): you want isolation — each bot is the same
  definition composed separately, nothing crosses except through a bridge
  you write.

For the single-instance walkthrough of the connection plugin itself, see
`websocket-bot`.
