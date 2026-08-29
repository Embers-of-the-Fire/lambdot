import type { Address, EventDef, OutputContract } from "@lambdot/core";
import type { WsSpec } from "@lambdot/websocket";

/** Where a wsecho message goes: the server's single broadcast channel. */
export type WsEchoAddress = Address<"wsecho">;

export type EchoEvents = {
    "wsecho.message": EventDef<string, WsEchoAddress>;
};

export type EchoOutputs = {
    wsecho: OutputContract<WsEchoAddress, string>;
};

/**
 * The plain, untagged spec — identical in every bot kernel. Multi-kernel
 * composition needs no per-instance names: each kernel owns its bus, output
 * registry, and capability map, so the same platform/kind/capability strings
 * can never collide. Instance identity lives in the transport config (the
 * URL), not in type-level names.
 */
export const echoSpec: WsSpec<"wsecho", WsEchoAddress, string, string, "wsecho.message"> = {
    platform: "wsecho",
    kind: "wsecho.message",
    decode: (data) => ({ payload: data, address: { platform: "wsecho" } }),
    encode: (content) => content,
};
