# @lambdot/console

The reference chat platform: a terminal needs no external service, so the
console is where the framework's contracts are exercised first. It exposes
the `consolePlatform` bundle — an input plugin that turns stdin lines into
a message stream and an output plugin that consumes a reply stream and
writes plain text back to the terminal.

## What it provides

- **A line stream.** `consoleLines()` emits a `Stream<ConsoleLine>`, where
  `ConsoleLine` is `Message<string, ConsoleAddress>` — one message per line
  read from stdin, payload the line text, minted with `message(line, ...)`.
  The address is `{ platform: "console", target: "stdout" }`. The stream is
  shared (broadcast), so several consumers may each subscribe to it.
- **An address type.** `ConsoleAddress extends Address<"console">` adds one
  field, `target: "stdout" | "stderr"`. Replying to `message.address` writes
  to stdout; constructing `{ platform: "console", target: "stderr" }`
  redirects a reply to stderr.
- **A reply contract.** `ConsoleReply` is `Command<ConsoleAddress, string>`
  — content is plain text, written with a trailing newline. The printer
  consumes a `Stream<ConsoleReply>`; because streams broadcast, one reply
  stream can feed the printer and a logger side by side.

## Usage

```ts
import { consolePlatform, type ConsoleLine } from "@lambdot/console";
import type { Stream } from "@lambdot/core";
import { createKernel, definePlugin, mapStream } from "@lambdot/core";

const echo = definePlugin({
    name: "echo",
    apply(input: { "console/lines": Stream<ConsoleLine> }) {
        return mapStream(input["console/lines"], (event) => ({
            address: event.address,
            content: `echo: ${event.payload}`,
        }));
    },
});

const cli = consolePlatform();

const kernel = createKernel()
    .use(cli.lines)
    // identity wiring: echo's input keys already match the visible ctx
    .use(echo)
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.echo }) });

await kernel.start();
```

The printer is terminal — it consumes a reply stream produced by later
feature plugins — so it is wired last with an explicit `mapping` from the
feature's namespace (`ctx.echo`) to the printer's declared input
(`{ replies }`). Wiring the printer before the feature is a compile error:
the `mapping` parameter is typed as the namespaces visible so far.

## API

- `consolePlatform(): ConsolePlatform` — builds both halves as
  `{ lines, printer }`. The pair stays separate (rather than one fused
  plugin) so feature plugins can be wired between them: the line source
  first, the features next, the printer last.
- `consoleLines()` — the input half, a `Plugin<void, Stream<ConsoleLine>, void, "console/lines">`.
  Reads stdin through `node:readline/promises` with `terminal: false` (line
  mode, no TTY echo handling); its disposer closes the readline interface
  and the stream.
- `consolePrinter()` — the output half, a
  `Plugin<{ replies: Stream<ConsoleReply> }, void, void, "console/printer">`.
  Pumps `replies` in the background; each command picks `process.stderr` or
  `process.stdout` by `address.target` and writes `${content}\n`.
- Types: `ConsoleAddress`, `ConsoleLine`, `ConsoleReply`, `ConsolePlatform`.

## Examples

- [echo-bot](../../examples/echo-bot) — the echo bot above, plus
  compile-time type tests for the composition wiring.
- [multi-echo-bot](../../examples/multi-echo-bot) — one echo feature
  serving the console and a websocket platform side by side.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
