import type { Address } from "@lambdot/core";
import type { WsSpec } from "@lambdot/websocket";

/** Where a wsecho message goes: the server's single broadcast channel. */
export type WsEchoAddress = Address<"wsecho">;

/**
 * The plain, untagged spec — identical in every bot composition. Multi-bot
 * composition needs no per-instance names: each composition's namespaces are
 * private, so the same platform and plugin names can never collide. Instance
 * identity lives in the transport config (the URL), not in type-level names.
 */
export const echoSpec: WsSpec<"wsecho", WsEchoAddress, string, string> = {
    platform: "wsecho",
    decode: (data) => ({ payload: data, address: { platform: "wsecho" } }),
    encode: (content) => content,
};
