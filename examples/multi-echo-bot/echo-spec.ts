import type { Address } from "@lambdot/core";
import type { WsSpec } from "@lambdot/websocket";

/** Where a wsecho message goes: the server's single broadcast channel. */
export type WsEchoAddress = Address<"wsecho">;

/** The plain-text spec: one decode/encode pair for the echo server. */
export const echoSpec: WsSpec<"wsecho", WsEchoAddress, string, string> = {
    platform: "wsecho",
    decode: (data) => ({ payload: data, address: { platform: "wsecho" } }),
    encode: (content) => content,
};
