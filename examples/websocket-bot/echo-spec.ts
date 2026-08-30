import type { Address } from "@lambdot/core";
import type { WsSpec } from "@lambdot/websocket";

/** Where a wsecho message goes: the server's single broadcast channel. */
export type WsEchoAddress = Address<"wsecho">;

/**
 * The specific half, deferred from the generic transport: plain-text frames.
 * A second platform costs one of these (~5 lines).
 */
export const echoSpec: WsSpec<"wsecho", WsEchoAddress, string, string> = {
    platform: "wsecho",
    decode: (data) => ({ payload: data, address: { platform: "wsecho" } }),
    encode: (content) => content,
};
