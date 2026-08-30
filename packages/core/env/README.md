# @lambdot/env

Reads variables from `process.env` into a typed namespace, so deployments
pass configuration through the environment and plugins consume it through
the composition's visible context — with the provider-before-consumer
ordering checked at compile time.

## What it provides

- **One plugin factory.** `envVars(name, keys)` reads each key from
  `process.env` at activation and emits the snapshot —
  `Readonly<Record<TKey, string>>` — under `name`. A missing or empty
  variable throws during activation, so a misconfigured deployment fails
  loudly before any consumer activates.
- **A typed namespace value.** Because the keys are a type parameter,
  consumers read `ctx["qq-env"].QQ_BOT_APP_ID` as `string` with no casts.
  The name is a parameter too, so instances multiply: two providers compose
  side by side under distinct names, exactly like `wsTransport` in
  `@lambdot/websocket`.

## Usage

```ts
import { createKernel, definePlugin } from "@lambdot/core";
import { envVars } from "@lambdot/env";

const report = definePlugin({
    name: "report",
    apply(input: { "qq-env": Readonly<Record<"QQ_BOT_APP_ID" | "QQ_BOT_APP_SECRET", string>> }) {
        const appId: string = input["qq-env"].QQ_BOT_APP_ID;
        // ...
    },
});

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(report); // before envVars: compile error — the mapping's ctx is
// typed as what's visible so far, and "qq-env" isn't in it
```

Consumers may also declare a wider view — any
`Readonly<Record<string, string>>` under the same namespace key — since the
emitted record stays assignable to it; `@lambdot/protocol-qq`'s plugins
consume `{ env: Readonly<Record<string, string>> }` this way, wired with an
explicit `mapping: (ctx) => ({ env: ctx["qq-env"] })`. Workers have no
`process.env`; `@lambdot/host-cloudflare` ships a counterpart `envVars`
that reads from a worker's bindings object into the same record shape.

## API

- `envVars<const TName extends string, const TKey extends string>(name: TName, keys: readonly TKey[])` —
  returns a `Plugin<void, Readonly<Record<TKey, string>>, void, TName>`. The
  snapshot is taken once in `apply`; the plugin takes no config.

## Examples

- [qq-gateway-bot](../../examples/qq-gateway-bot) — `envVars("qq-env", ...)`
  feeds the qq platform's api plugin through its `mapping`.
- [qq-webhook-bot](../../examples/qq-webhook-bot) — the same env wiring over
  webhooks.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
