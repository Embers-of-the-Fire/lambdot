# @lambdot/console

The reference chat platform: a terminal needs no external service, so the
console is where the framework's contracts are exercised first. It exposes
the `consolePlatform` bundle — an input plugin that turns stdin lines into
events and an output plugin that writes plain text back to the terminal.

## What it provides

- **One event kind.** `ConsoleEvents` is exactly
  `{ "console.line": EventDef<string, ConsoleAddress> }` — one event per line
  read from stdin, payload the line text. The input ingests each line with
  address `{ platform: "console", target: "stdout" }`.
- **An address type.** `ConsoleAddress extends Address<"console">` adds one
  field, `target: "stdout" | "stderr"`. Replying to `event.address` writes
  to stdout; constructing `{ platform: "console", target: "stderr" }`
  redirects a send to stderr.
- **An output contract.** `ConsoleOutputs` is
  `{ console: OutputContract<ConsoleAddress, string> }` — content is plain
  text, written with a trailing newline. `ctx.send(address, content)` only
  compiles when the content matches the platform that owns the address.

## Usage

```ts
import { consolePlatform, type ConsoleEvents, type ConsoleOutputs } from "@lambdot/console";
import { createKernel, definePlugin } from "@lambdot/core";

const echo = definePlugin<ConsoleEvents, ConsoleOutputs>({
    name: "echo",
    apply(ctx) {
        return ctx.on("console.line", (event) => ctx.send(event.address, `echo: ${event.payload}`));
    },
});

const cli = consolePlatform();

const kernel = createKernel().use(cli.input).use(cli.output).use(echo);

await kernel.start();
```

## API

- `consolePlatform(): ConsolePlatform` — builds both halves as
  `{ input, output }`. The pair stays separate (rather than one fused
  plugin) so the type fold keeps enforcing registration order: input and
  output before the feature plugins that consume them.
- `consoleInput(): InputPlugin<ConsoleEvents, void, "console-input">` — the
  input half. Reads stdin through `node:readline/promises` with
  `terminal: false` (line mode, no TTY echo handling); its disposer closes
  the readline interface.
- `consoleOutput(): OutputPlugin<"console", ConsoleAddress, string, void, "console-output">` —
  the output half. `send(to, content)` picks `process.stderr` or
  `process.stdout` by `to.target` and writes `${content}\n`.
- Types: `ConsoleAddress`, `ConsoleEvents`, `ConsoleOutputs`,
  `ConsolePlatform`.

## Examples

- [echo-bot](../../examples/echo-bot) — the echo bot above, plus
  compile-time type tests for the registration-order gate.
- [multi-echo-bot](../../examples/multi-echo-bot) — one echo feature
  serving the console and a websocket platform side by side.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
