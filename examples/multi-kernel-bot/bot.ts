import type { InputPlugin } from "@lambdot/core";
import { createKernel, definePlugin } from "@lambdot/core";
import { wsPlatform } from "@lambdot/websocket";

import { echoSpec, type EchoEvents, type EchoOutputs } from "./echo-spec.ts";

/**
 * The cross-kernel handle a bot exposes. Deliberately narrow: the supervisor
 * can push a message into this bot's pipeline, nothing more. Provided by an
 * input plugin because `ingest` exists only on the input context — the typed
 * surface reserves pipeline ingress for inputs.
 */
export interface EchoBridge {
    ingest(payload: string): Promise<void>;
}

function bridgePort(): InputPlugin<
    EchoEvents,
    void,
    "bridge-port",
    { readonly bridge: EchoBridge }
> {
    return {
        role: "input",
        name: "bridge-port",
        apply(ctx) {
            return ctx.provide("bridge", {
                ingest: (payload) => ctx.ingest("wsecho.message", payload, { platform: "wsecho" }),
            });
        },
    };
}

/**
 * One bot = one kernel. The stack is byte-for-byte identical for every
 * instance — same `"ws"` capability, same `"wsecho"` platform and kind —
 * because each kernel's registries are private. Instance identity lives in
 * the factory arguments (name for logs, url for the socket), not in
 * type-level names.
 *
 * One rule: never share plugin objects across kernels. `wsOutput` keeps its
 * connection in a factory closure, so two kernels using the same object
 * would overwrite each other's connection — the factory mints fresh plugin
 * instances per kernel (each `use()` still gets its own fiber regardless).
 */
export function createEchoBot(name: string, url: string) {
    const wsecho = wsPlatform("ws", echoSpec);
    const reply = definePlugin<EchoEvents, EchoOutputs>({
        name: "reply",
        apply(ctx) {
            return ctx.on("wsecho.message", (event) => {
                console.log(
                    `[bot ${name}] id=${event.id} kind=${event.kind} payload=${event.payload}`,
                );
                return ctx.send(event.address, `echo: ${event.payload}`);
            });
        },
    });

    return createKernel({ onError: (error) => console.error(`[bot ${name}]`, error) })
        .use(wsecho.transport, { url })
        .use(wsecho.input)
        .use(wsecho.output)
        .use(bridgePort())
        .use(reply);
}

export type EchoBot = ReturnType<typeof createEchoBot>;
