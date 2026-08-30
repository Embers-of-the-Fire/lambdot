import type { Address } from "@lambdot/core";
import type { WsSpec } from "@lambdot/websocket";

/** Where a tagged wsecho message goes: that server's single broadcast channel. */
export type WsEchoAddress<TTag extends string> = Address<`wsecho-${TTag}`>;

/**
 * One spec per instance. Composition namespaces key on strings, so a second
 * instance is only safe when the tag differs: the platform name (and thus
 * the `…/transport` and `…/output` namespaces) must be unique per instance.
 * Reusing one name twice is a compile-time "duplicate namespace" error.
 */
export function echoSpec<const TTag extends string>(
    tag: TTag,
): WsSpec<`wsecho-${TTag}`, WsEchoAddress<TTag>, string, string> {
    const platform = `wsecho-${tag}` as const;
    return {
        platform,
        decode: (data) => ({ payload: data, address: { platform } }),
        encode: (content) => content,
    };
}
