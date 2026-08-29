# multi-echo-bot

One echo behavior served on **two platforms at once** — console
(stdin/stdout) and websocket — from a single kernel. This is the reuse
story of the lambdot design: platform specifics live in the input/output
plugin pairs, and feature plugins written against the generic envelope work
everywhere.

```sh
nub run -F @lambdot-example/multi-echo-bot start
```

The script first verifies the websocket leg end-to-end with a raw client,
then leaves the console leg live: type a line, get `echo: <line>` back on
stdout. `Ctrl+C` stops the kernel.

## How the reuse works

The shared feature is [`echo.ts`](./echo.ts) — the whole thing is:

```ts
export const echo = definePlugin<ConsoleEvents & EchoEvents, ConsoleOutputs & EchoOutputs>({
    name: "echo",
    apply(ctx) {
        function reply(event: BotEvent<string, string, ConsoleAddress | WsEchoAddress>) {
            return ctx.send(event.address, `echo: ${event.payload}`);
        }

        return [ctx.on("console.line", reply), ctx.on("wsecho.message", reply)];
    },
});
```

Three properties of the core make this one handler serve both platforms:

1. **The envelope carries its own return address.** `BotEvent.address` is
   opaque to the core and produced/consumed by a platform's input/output
   pair. `ctx.send(event.address, ...)` routes back through whichever output
   owns the address's `platform` tag — the feature never inspects it.
2. **A feature can declare events and outputs from several platforms.**
   `TNeeds`/`TSends` are full maps, so `ConsoleEvents & EchoEvents` and
   `ConsoleOutputs & EchoOutputs` give one plugin typed access to both
   worlds. `ContentFor` distributes over the address union, so `send`
   type-checks per platform through the same call (here both contracts
   accept `string`).
3. **The type fold enforces wiring order.** `use(echo)` is a compile error
   unless both input halves _and_ both output halves are already registered
   — see the chain in [`index.ts`](./index.ts).

## File layout

| File           | Role                                                               |
| -------------- | ------------------------------------------------------------------ |
| `echo.ts`      | The shared feature plugin — the only file that is "the bot".       |
| `echo-spec.ts` | The websocket platform's specific half: platform tag, kind, codec. |
| `server.ts`    | Demo broadcast server standing in for a real chat service.         |
| `index.ts`     | Composition root: one kernel, both platforms, self-check + REPL.   |

The console platform needs no local files — it comes from
`@lambdot/input-console` / `@lambdot/output-console`; the websocket
transport and the `wsInput`/`wsOutput` factories come from
`@lambdot/websocket`.

## Extending to a real third platform (e.g. Discord)

A Discord-over-websocket platform would slot in without touching `echo.ts`
beyond widening two type unions and adding one `ctx.on` line:

1. Write a `discord-spec.ts` like `echo-spec.ts`: platform tag
   `"discord"`, event kind `"discord.message"`, and a `decode` that
   normalizes Discord's frame into `{ payload: string, address }` (the
   address carrying whatever the reply needs — channel id, reply reference).
2. Declare `const discord = wsPlatform("ws-discord", discordSpec)` and
   register `.use(discord.transport, config).use(discord.input).use(discord.output)`
   before `.use(echo)`. The capability name is what keeps it independent of
   the existing `"ws"` transport: both connections live side by side in one
   kernel, and each platform's plugins activate with their own.
3. Widen the feature's declared maps and the `reply` address union.

If a platform's payload can't be normalized to `string` in `decode`, branch
on `event.kind` inside the feature, or keep per-platform thin reply plugins
around a shared pure function (`formatEcho(payload)`).
