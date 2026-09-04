# @lambdot/protocol-qq

The QQ wire protocol for lambdot: a webhook post handler composed on the
structural [`@lambdot/http`](../../core/http) server contract, plus the
shared REST client. QQ pushes events to an HTTPS callback address; sending
a message is always an HTTPS call against the open platform.

## How it fits the model

The webhook is an ordinary plugin that declares `{ http: HttpServer }` in
its input — the abstract/handler pattern. A host (a hono server via
`@lambdot/host-hono`, another framework through an adapter) supplies the
server; the plugin registers its callback route on it at application time,
and the route lives as long as the host's server. The plugin's item map is
the receiving service: `onMessage(listener)` hands each decoded dispatch to
subscribers together with its reply channel — the address (scope, openid,
`msg_id` reference) travels with the event, so a reply is just
`event.reply(content)`.

## The callback algorithm

`qqWebhook` implements the platform's verification rules:

- **op 13 — callback-address validation**: sign `event_ts + plain_token`
  and answer with the signature (no verification).
- **every other request**: verify the ed25519 `X-Signature-Ed25519` header
  over `timestamp + body`; a forged signature gets a 401.
- **op 0 dispatches**: decode `GROUP_AT_MESSAGE_CREATE` /
  `C2C_MESSAGE_CREATE` bodies and deliver them to `onMessage` listeners.

The bot secret seeds the ed25519 keypair (repeated to 32 bytes). Credentials
come from an env namespace (see `@lambdot/env`) via `readQqCredentials` —
`QQ_BOT_APP_ID` and `QQ_BOT_APP_SECRET` by default, overridable through
`QqCredentialKeys` in the config.

## Usage

```ts
import { createScope, definePlugin } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { qqWebhook, type QqWebhook } from "@lambdot/protocol-qq";

const reply = definePlugin({
    name: "reply",
    apply(input: { qq: QqWebhook }, scope) {
        scope.onDispose(
            input.qq.onMessage((event) => void event.reply(`echo: ${event.message.content}`)),
        );
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qqWebhook("qq"), {
        option: {}, // or { path: "/qq/callback", apiBase, keys }
        mapping: (ctx) => ({ http: ctx.http, env: ctx["qq-env"] }),
    })
    .use(reply);

const scope = createScope();
await app.apply({}, scope, undefined);
// ... later: await scope.dispose();
```

(`ctx.http` is whatever `HttpServer` the host wired in — e.g. a hono app
from `@lambdot/host-hono`.) `option` is required (even as `{}`) wherever
the plugin's config type is non-void.

## API overview

- `qqWebhook(name)` — the webhook post handler; emits `QqWebhook`
  (`onMessage(listener): Disposer`) under `name`. `QqWebhookConfig` carries
  `path` (default `"/qq/callback"`), `keys`, and `apiBase`.
- `QqMessageEvent` — `{ message, reply(content) }`: one decoded dispatch
  plus its passive-reply channel.
- `qqApi(name)` — the REST client as a plugin, emitting `QqApi` under
  `name`; consumes `{ env: Readonly<Record<string, string>> }`. `QqApi`
  owns the access-token lifecycle (cached, refreshed ahead of expiry) and
  exposes `appId`, `accessToken()`, `gatewayUrl()`, and
  `sendMessage(to, content)` — plain text (`msg_type` 0) to
  `/v2/groups/:openid/messages` or `/v2/users/:openid/messages`. When the
  address carries a `msgId` the send is a passive reply: `msg_seq` is taken
  from the address or auto-incremented per `msgId` when omitted.
  `createQqApi(credentials, options?)` builds the same client outside a
  composition.
- `QqAddress` — `scope: "group" | "c2c"`, `openid` (`group_openid` or the
  user's openid), optional `msgId`/`msgSeq` passive-reply reference.
- `QqMessage` — the plain-text payload (`id`, `content`, `authorOpenid`,
  `timestamp`).
- `decodeMessageEvent(t, d)` — decode a dispatch pair into
  `{ message, address }`, or null to ignore.
- `readQqCredentials`, `QqCredentials`, `QqCredentialKeys`,
  `DEFAULT_QQ_CREDENTIAL_KEYS` — the credentials half.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
