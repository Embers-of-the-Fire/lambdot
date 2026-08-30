# multi-echo-bot

One echo behavior served on **two platforms at once** — console
(stdin/stdout) and websocket — from a single kernel. This is the reuse
story of the lambdot design: platform specifics live in the input/output
plugin pairs, and feature plugins written against the generic envelope work
everywhere. The single-platform siblings are [echo-bot](../echo-bot)
(console only) and [websocket-bot](../websocket-bot) (websocket only).

```console
$ nub run -F @lambdot-example/multi-echo-bot start
```

The script first verifies the websocket leg end-to-end with a raw client,
then leaves the console leg live: type a line, get `echo: <line>` back on
stdout. `Ctrl+C` stops the kernel.

## How the reuse works

The shared feature is [`echo.ts`](./echo.ts) — the whole thing is:

```ts
export const echo = definePlugin({
    name: "echo",
    apply(input: {
        "console/lines": Stream<ConsoleLine>;
        wsecho: Stream<Message<string, WsEchoAddress>>;
    }) {
        function reply(event: Message<string, ConsoleLine["address"] | WsEchoAddress>) {
            return { address: event.address, content: `echo: ${event.payload}` };
        }

        return mergeStreams(
            mapStream(input["console/lines"], reply),
            mapStream(input.wsecho, reply),
        );
    },
});
```

Three properties of the core make this one feature serve both platforms:

1. **The envelope carries its own return address.** `Message.address` is
   opaque to the core and produced/consumed by a platform's input/output
   pair. The command the feature emits reuses the incoming address, so the
   reply routes back through whichever output claims the address's
   `platform` tag — the feature never inspects it.
2. **A feature's input is a record of streams from several platforms.**
   The declared input — `{ "console/lines": …; wsecho: … }` — gives one
   plugin typed access to both worlds, and `mergeStreams` interleaves the
   two mapped streams into one command stream. The mapper type-checks per
   platform through the same function (both payloads are `string`).
3. **Reply routing happens at the wiring.** Each output's `mapping` filters
   the merged command stream down to its own platform with a type-guard
   `filterStream` — `cmd.address.platform === "console"` for the printer,
   `=== "wsecho"` for the websocket output — so every command reaches
   exactly one output, typed with that platform's address. Composing
   `.use(echo)` before both message streams exist is a compile error,
   because identity wiring can no longer satisfy the declared input — see
   the chain in [`index.ts`](./index.ts).

## File layout

| File           | Role                                                               |
| -------------- | ------------------------------------------------------------------ |
| `echo.ts`      | The shared feature plugin — the only file that is "the bot".       |
| `echo-spec.ts` | The websocket platform's specific half: platform tag, frame codec. |
| `server.ts`    | Demo broadcast server standing in for a real chat service.         |
| `index.ts`     | Composition root: one kernel, both platforms, self-check + REPL.   |

The console platform needs no local files — it comes from
`@lambdot/console` (the `consolePlatform` bundle); the websocket
transport and the `wsInput`/`wsOutput` factories come from
`@lambdot/websocket`.

## Extending to a real third platform (e.g. Discord)

A Discord-over-websocket platform would slot in without touching `echo.ts`
beyond widening the input record and adding one `mapStream` line:

1. Write a `discord-spec.ts` like `echo-spec.ts`: platform tag
   `"discord"` and a `decode` that normalizes Discord's frame into
   `{ payload: string, address }` (the address carrying whatever the reply
   needs — channel id, reply reference).
2. Declare `const discord = wsPlatform("discord", discordSpec)` and wire
   `.bind(discord.transport, { option: … }).use(discord.input, { mapping: … })`
   before `.use(echo)`, plus `.bind(discord.output, …)` after it with its
   own `filterStream(ctx.echo, … === "discord")` mapping. The platform name
   is what keeps it independent of the existing `"wsecho"` instance: both
   connections live side by side in one kernel, each platform's plugins
   wired to their own transport.
3. Widen the feature's declared input record and the `reply` address union.

If a platform's payload can't be normalized to `string` in `decode`, branch
on the payload shape inside the feature, or keep per-platform thin reply
plugins around a shared pure function (`formatEcho(payload)`).
