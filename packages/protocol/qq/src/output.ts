import type { OutputPlugin } from "@lambdot/core";

import type { QqApi, QqCapability } from "./api.ts";
import type { QqAddress } from "./events.ts";

/**
 * The output half of the qq platform: plain text (msg_type 0) through the
 * REST client provided by `qqApi`. Sending is transport-independent — the
 * gateway and webhook infras share this output.
 */
export function qqOutput<TApiCap extends string>(
    api: TApiCap,
): OutputPlugin<"qq", QqAddress, string, void, "qq-output", {}, QqCapability<TApiCap>> {
    let client: QqApi | undefined;
    return {
        role: "output",
        name: "qq-output",
        platform: "qq",
        inject: [api],
        async send(to, content) {
            if (!client) throw new Error('output "qq" is not active');
            await client.sendMessage(to, content);
        },
        apply(ctx) {
            client = ctx[api];
            return () => {
                client = undefined;
            };
        },
    };
}
