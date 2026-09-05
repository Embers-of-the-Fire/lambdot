---
"@lambdot/protocol-qq": minor
---

Replace the message-bound QQ protocol with the full C2C/group infra, per the
official documentation. **Breaking**: `QqAddress`, `QqMessageEvent.reply`,
`decodeMessageEvent`, and the client's auto-incremented `msg_seq` state are
gone. The webhook is now a pure listener (`onEvent`) decoding every C2C/group
dispatch — message events (`C2C_MESSAGE_CREATE`, `GROUP_AT_MESSAGE_CREATE`,
and full-mode `GROUP_MESSAGE_CREATE`, with author/attachments/mentions/scene),
`INTERACTION_CREATE`, friend and group lifecycle/gate events, and group
member/join-request events; guild-scene dispatches are dropped. Sending
resolves from a caller-provided `QqMessageContext` (`{ msgId, msgSeq? }`,
`{ eventId }`, `{ wakeup: true }`, or active) via
`sendC2cMessage`/`sendGroupMessage`, which cover text/markdown/input-notify/
rich-media payloads with keyboards and quote references and return the sent
message's id. The client also gains `recallC2cMessage`/`recallGroupMessage`,
`uploadC2cFile`/`uploadGroupFile`, and `ackInteraction`.
