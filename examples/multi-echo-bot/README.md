# multi-echo-bot

One echo behavior served on **two services at once** — console
(stdin/stdout) and websocket — from a single composition. This is the reuse
story of the lambdot design: services are ordinary plugins whose item maps
are plain interfaces, and feature plugins written against those interfaces
compose with any combination of them. The single-service siblings are
[echo-bot](../echo-bot) (console only) and [websocket-bot](../websocket-bot)
(websocket only).

```console
$ nub run -F @lambdot-example/multi-echo-bot start
```

The script first verifies the websocket leg end-to-end with a raw client,
then leaves the console leg live: type a line, get `echo: <line>` back on
stdout. `Ctrl+C` disposes the scope.

## How the reuse works

The shared feature is [`echo.ts`](./echo.ts) — the whole thing is:

```ts
export const echo = definePlugin({
    name: "echo",
    apply(input: { console: ConsoleIo; socket: WsConnection }, scope) {
        scope.onDispose(input.console.onLine((line) => input.console.print(`echo: ${line}`)));
        scope.onDispose(input.socket.listen((data) => input.socket.push(`echo: ${data}`)));
    },
});
```

Two properties of the model make this one feature serve both services:

1. **A feature's input is a record of services.** The declared input —
   `{ console: ConsoleIo; socket: WsConnection }` — gives one plugin typed
   access to both worlds. Composing `.use(echo)` before both namespaces
   exist is a compile error, because identity wiring can no longer satisfy
   the declared input — see the chain in [`index.ts`](./index.ts).
2. **The reply channel travels with the subscription.** Each listener's
   closure replies through the service it subscribed to — `print` for the
   console, `push` for the socket. There is no envelope, no return address,
   and no routing at the wiring: the feature knows where each input came
   from because it wired both subscriptions itself.

Both services are hermetic (`with`): a terminal and a socket observe
nothing of their surroundings. Their item maps are injected under their
namespaces, and the feature reads them like any other context value.

## File layout

| File        | Role                                                             |
| ----------- | ---------------------------------------------------------------- |
| `echo.ts`   | The shared feature plugin — the only file that is "the bot".     |
| `server.ts` | Demo broadcast server standing in for a real chat service.       |
| `index.ts`  | Composition root: both services, one feature, self-check + REPL. |
