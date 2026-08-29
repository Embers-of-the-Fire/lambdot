import type { Address, EventDef, OutputContract } from "@lambdot/core";
import type { WsSpec } from "@lambdot/websocket";

/** Where a tagged wsecho message goes: that server's single broadcast channel. */
export type WsEchoAddress<TTag extends string> = Address<`wsecho-${TTag}`>;

export type EchoEvents<TTag extends string> = {
    [K in `wsecho-${TTag}.message`]: EventDef<string, WsEchoAddress<TTag>>;
};

export type EchoOutputs<TTag extends string> = {
    [K in `wsecho-${TTag}`]: OutputContract<WsEchoAddress<TTag>, string>;
};

/**
 * One spec per instance. Dispatch keys on strings, so a second instance is
 * only safe when the tag differs: the bus's `kind` key, the kernel's output
 * registry (`platform`), and the transport's capability name must all be
 * unique per instance. Reusing one spec twice throws at activation with
 * "duplicate output for platform" — and even without that check, same-kind
 * events from both sockets would merge into one dispatch stream, since the
 * envelope carries no socket identity beyond the (identical) address.
 */
export function echoSpec<TTag extends string>(
    tag: TTag,
): WsSpec<`wsecho-${TTag}`, WsEchoAddress<TTag>, string, string, `wsecho-${TTag}.message`> {
    const platform = `wsecho-${tag}` as const;
    return {
        platform,
        kind: `${platform}.message`,
        decode: (data) => ({ payload: data, address: { platform } }),
        encode: (content) => content,
    };
}
