import type { Address, EventDef, OutputContract } from "@lambdot/core";

import type { WsSpec } from "./transport.ts";

/** Where a wsecho message goes: the server's single broadcast channel. */
export type WsEchoAddress = Address<"wsecho">;

export type EchoEvents = {
    "wsecho.message": EventDef<string, WsEchoAddress>;
};

export type EchoOutputs = {
    wsecho: OutputContract<WsEchoAddress, string>;
};

/**
 * The specific half, deferred from the generic transport: plain-text frames,
 * one event kind. A second platform costs one of these (~15 lines).
 */
export const echoSpec: WsSpec<"wsecho", WsEchoAddress, string, string, "wsecho.message"> = {
    platform: "wsecho",
    kind: "wsecho.message",
    decode: (data) => ({ payload: data, address: { platform: "wsecho" } }),
    encode: (content) => content,
};
