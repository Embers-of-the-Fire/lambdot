import type { Address } from "@lambdot/core";
import type { WsSpec } from "@lambdot/websocket";

/** Where a dochat message goes: the room's broadcast channel. */
export type DoChatAddress = Address<"dochat">;

/**
 * The specific half, deferred from the generic websocket machinery:
 * plain-text frames — the same shape as the echo spec in
 * `../websocket-bot`, but served by a Durable Object's hub instead of a
 * client transport dialing out.
 */
export const chatSpec: WsSpec<"dochat", DoChatAddress, string, string> = {
    platform: "dochat",
    decode: (data) => ({ payload: data, address: { platform: "dochat" } }),
    encode: (content) => content,
};
