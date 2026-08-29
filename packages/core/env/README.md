# @lambdot/env

Reads variables from `process.env` into a typed capability, so deployments
pass configuration through the environment and plugins consume it through
the kernel's capability fold — with the provider-before-consumer ordering
checked at compile time.

## What it provides

- **A capability contract.** `EnvCapability<TCap, TKey>` maps the capability
  name to a snapshot of the requested variables:
  `{ readonly [K in TCap]: Readonly<Record<TKey, string>> }`. The provider
  declares it as `TProvides`, consumers as `TInjects`. The name is a
  parameter, so instances multiply: two providers fold side by side as
  `EnvCapability<"qq-env"> & EnvCapability<"discord-env">`, exactly like
  `WsCapability` in `@lambdot/websocket`.
- **One plugin factory.** `envVars(capability, keys)` reads each key from
  `process.env` at kernel start and provides the snapshot under
  `capability`. A missing or empty variable throws during activation, so a
  misconfigured deployment fails loudly before any consumer activates.

## Usage

```ts
import { createKernel, definePlugin } from "@lambdot/core";
import { envVars, type EnvCapability } from "@lambdot/env";

type QqEnv = EnvCapability<"qq-env", "QQ_BOT_APP_ID" | "QQ_BOT_APP_SECRET">;

// typed injection: TInjects folds the snapshot into the apply context
const report = definePlugin<{}, {}, undefined, void, "report", {}, QqEnv>({
    name: "report",
    apply(ctx) {
        const appId: string = ctx["qq-env"].QQ_BOT_APP_ID;
        return () => {};
    },
});

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(report); // before envVars: compile error, "unprovided capabilities"
```

Consumers may also declare a wider view — any
`Readonly<Record<string, string>>` under the same capability name — since
`EnvCapability<TCap, TKey>` narrows the keys but stays assignable to it;
`@lambdot/protocol-qq`'s `QqEnvNeeds` works this way. Workers have no
`process.env`; `@lambdot/host-cloudflare` ships a counterpart `envVars`
that reads from a worker's bindings object into the same capability shape.

## API

- `envVars<TCap extends string, TKey extends string>(capability: TCap, keys: readonly TKey[])` —
  returns a `FeaturePlugin` named `env:<capability>` with
  `TProvides = EnvCapability<TCap, TKey>` and no config. The snapshot is
  taken once in `apply` and provided via `ctx.provide`; unloading the
  plugin withdraws the capability.
- `EnvCapability<TCap, TKey>` — the shared provider/consumer contract type.

## Examples

- [qq-gateway-bot](../../examples/qq-gateway-bot) — `envVars("qq-env", ...)`
  feeds the qq platform's api plugin; its `type-test.ts` exercises the
  compile-time gate and the typed readback (`kernel.ctx["qq-env"].QQ_BOT_APP_ID`).
- [qq-webhook-bot](../../examples/qq-webhook-bot) — the same capability
  wiring over webhooks.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
