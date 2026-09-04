# @lambdot/protocol-qq

The QQ wire protocol for lambdot: the full C2C (单聊) and group (群聊) infra of
the [QQ bot open platform](https://bot.q.qq.com/wiki/) — a webhook event
listener composed on the structural [`@lambdot/http`](../../core/http) server
contract, plus the secure REST client. Guild (频道) infra is out of scope.
QQ pushes events to an HTTPS callback address; every send is an authenticated
HTTPS call against the open platform.

## How it fits the model

The webhook is an ordinary plugin that declares `{ http: HttpServer }` in
its input — the abstract/handler pattern. A host (a hono server via
`@lambdot/host-hono`, another framework through an adapter) supplies the
server; the plugin registers its callback route on it at application time,
and the route lives as long as the host's server. The plugin's item map is
the receiving service: `onEvent(listener)` hands each decoded dispatch to
subscribers. The webhook is a pure listener — it holds no REST client and no
per-message state.

Sending goes through `qqApi`, the REST client plugin. Every send resolves
its passive/active nature from the **context the caller provides** — usually
the `context` property of the event being answered — never from state bound
into the client:

```ts
input.qq.onEvent((event) => {
    if (event.type === "GROUP_AT_MESSAGE_CREATE")
        void api.sendGroupMessage(event.groupOpenid, { msgType: 0, content: "hi" }, event.context);
});
```

## The callback algorithm

`qqWebhook` implements the platform's verification rules:

- **op 13 — callback-address validation**: sign `event_ts + plain_token`
  and answer with the signature (no verification).
- **every other request**: verify the ed25519 `X-Signature-Ed25519` header
  over `timestamp + body`; a forged signature gets a 401.
- **op 0 dispatches**: decode and deliver to `onEvent` listeners.

The bot secret seeds the ed25519 keypair (repeated to 32 bytes). Credentials
come from an env namespace (see `@lambdot/env`) via `readQqCredentials` —
`QQ_BOT_APP_ID` and `QQ_BOT_APP_SECRET` by default, overridable through
`QqCredentialKeys` in the config.

## Event listening

`decodeQqEvent` decodes every C2C/group dispatch of the platform; guild-scene
dispatches (including guild interactions) are dropped. Message content is
delivered verbatim — for `GROUP_AT_MESSAGE_CREATE` the platform has already
stripped the `@bot` prefix, padding included.

| Event                                                          | Decoded as                              | Reply context           |
| -------------------------------------------------------------- | --------------------------------------- | ----------------------- |
| `C2C_MESSAGE_CREATE`                                           | `QqC2cMessageEvent`                     | `{ msgId }`             |
| `GROUP_AT_MESSAGE_CREATE` / `GROUP_MESSAGE_CREATE` (full mode) | `QqGroupMessageEvent`                   | `{ msgId }`             |
| `INTERACTION_CREATE` (c2c/group scenes)                        | `QqInteractionEvent`                    | `{ eventId }`           |
| `FRIEND_ADD` / `FRIEND_DEL`                                    | `QqFriendAddEvent` / `QqFriendDelEvent` | `{ eventId }` (add)     |
| `C2C_MSG_RECEIVE` / `C2C_MSG_REJECT`                           | `QqC2cMsgGateEvent`                     | `{ eventId }` (receive) |
| `GROUP_ADD_ROBOT` / `GROUP_DEL_ROBOT`                          | `QqGroupRobotEvent`                     | `{ eventId }` (add)     |
| `GROUP_MSG_RECEIVE` / `GROUP_MSG_REJECT`                       | `QqGroupMsgGateEvent`                   | `{ eventId }` (receive) |
| `GROUP_MEMBER_ADD` / `GROUP_MEMBER_REMOVE`                     | `QqGroupMemberEvent`                    | —                       |
| `GROUP_JOIN_REQUEST`                                           | `QqGroupJoinRequestEvent`               | —                       |

Message events carry the full payload: author, attachments, mentions,
`messageType`, and the scene (`message_scene.ext` decoded from its
`key=value` wire form into a record — `msg_idx`, `auth_token`, …). The
platform may push the same `msg_id` more than once; deduplicate on
`message.id` (or `scene.ext.msg_idx`) if exactly-once matters.

## Secure API requests

`QqApi` owns the access-token lifecycle (cached, refreshed ahead of expiry)
and authorizes every call with `QQBot <token>`. Sends resolve their mode
from the caller-provided `QqMessageContext`:

- `{ msgId, msgSeq? }` — a passive reply to a message (`msg_id`; the
  platform rejects a repeated `msg_id + msg_seq` pair, so callers increment
  `msgSeq` themselves to reply more than once).
- `{ eventId }` — a passive reply to an event (`event_id`).
- `{ wakeup: true }` — an interaction-recall message (`is_wakeup`).
- omitted — an active message.

The union enforces the platform's mutual exclusions at the type level.
`QqOutgoingMessage` covers the wire `msg_type`s: text (0), markdown (2),
`input_notify` "typing…" state (6, C2C only — group sends reject it), and
rich media (7, with `fileInfo` from the matching scene's upload — C2C and
group uploads are not interchangeable), plus inline keyboards and quote
references (`message_reference`).

## Usage

```ts
import { createScope, definePlugin } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { qqApi, qqWebhook, type QqApi, type QqWebhook } from "@lambdot/protocol-qq";

const reply = definePlugin({
    name: "reply",
    apply(input: { qq: QqWebhook; api: QqApi }, scope) {
        scope.onDispose(
            input.qq.onEvent((event) => {
                if (event.type === "C2C_MESSAGE_CREATE")
                    void input.api.sendC2cMessage(
                        event.userOpenid,
                        { msgType: 0, content: `echo: ${event.message.content.trim()}` },
                        event.context,
                    );
            }),
        );
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qqWebhook("qq"), {
        option: {}, // or { path: "/qq/callback", keys }
        mapping: (ctx) => ({ http: ctx.http, env: ctx["qq-env"] }),
    })
    .use(qqApi("api"), {
        option: {}, // or { apiBase, keys }
        mapping: (ctx) => ({ env: ctx["qq-env"] }),
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
  (`onEvent(listener): Disposer`) under `name`. `QqWebhookConfig` carries
  `path` (default `"/qq/callback"`) and `keys`.
- `QqEvent` — the decoded-dispatch union (see the table above);
  `decodeQqEvent(frame)` decodes an op-0 frame, or null to ignore it.
- `qqApi(name)` — the REST client as a plugin, emitting `QqApi` under
  `name`; consumes `{ env: Readonly<Record<string, string>> }`. `QqApi`
  exposes `appId`, `accessToken()`, `gatewayUrl()`, and:
    - `sendC2cMessage(userOpenid, message, context?)` /
      `sendGroupMessage(groupOpenid, message, context?)` — resolve to
      `QqSentMessage` (`id`, `timestamp`, `refIdx`).
    - `recallC2cMessage(userOpenid, messageId)` /
      `recallGroupMessage(groupOpenid, messageId)` — the bot's own messages,
      at most 2 minutes old (group admins may also recall members' messages).
    - `uploadC2cFile(userOpenid, file)` / `uploadGroupFile(groupOpenid, file)`
      — resolve to `QqUploadedFile` (`fileInfo` + `ttl`).
    - `ackInteraction(interactionId, code?)` — answer an `INTERACTION_CREATE`;
      required for button (type 11) and quick-menu (type 12) interactions.
      `createQqApi(credentials, options?)` builds the same client outside a
      composition.
- `QqMessageContext`, `QqOutgoingMessage`, `QqMarkdown`, `QqKeyboard` and
  its button types, `QqFileUpload`, `QqUploadedFile`, `QqSentMessage` — the
  request/response shapes.
- `readQqCredentials`, `QqCredentials`, `QqCredentialKeys`,
  `DEFAULT_QQ_CREDENTIAL_KEYS` — the credentials half.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
