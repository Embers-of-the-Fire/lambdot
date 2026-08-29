import type { Address, EventDef, OutputContract } from "@lambdot/core";
import type { WsSpec } from "@lambdot/websocket";

/** Where a dochat message goes: the room's broadcast channel. */
export type DoChatAddress = Address<"dochat">;

export type ChatEvents = {
    "dochat.message": EventDef<string, DoChatAddress>;
};

export type ChatOutputs = {
    dochat: OutputContract<DoChatAddress, string>;
};

/**
 * The specific half, deferred from the generic websocket machinery:
 * plain-text frames, one event kind — the same shape as the echo spec in
 * `../websocket-bot`, but served by a Durable Object's hub instead of a
 * client transport dialing out.
 */
export const chatSpec: WsSpec<"dochat", DoChatAddress, string, string, "dochat.message"> = {
    platform: "dochat",
    kind: "dochat.message",
    decode: (data) => ({ payload: data, address: { platform: "dochat" } }),
    encode: (content) => content,
};
