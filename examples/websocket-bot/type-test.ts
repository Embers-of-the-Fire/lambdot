/**
 * Compile-time assertions for the generic-transport pattern, mirroring
 * echo-bot/type-test.ts: mapping-based wiring and namespace visibility must
 * keep working through the generic `@lambdot/websocket` factories —
 * including with two websocket platforms in one composition.
 */
import type { Command, Message, Stream } from "@lambdot/core";
import { createKernel, definePlugin, mapStream } from "@lambdot/core";
import { wsPlatform } from "@lambdot/websocket";

import { echoSpec, type WsEchoAddress } from "./echo-spec.ts";

const reply = definePlugin({
    name: "reply",
    apply(input: { wsecho: Stream<Message<string, WsEchoAddress>> }) {
        return mapStream(input.wsecho, (event) => ({
            address: event.address,
            content: `echo: ${event.payload}`,
        }));
    },
});

const wsecho = wsPlatform("wsecho", echoSpec);

const kernel = createKernel()
    .bind(wsecho.transport, { option: { url: "ws://localhost:1" } })
    .use(wsecho.input, { mapping: (ctx) => ({ connection: ctx["wsecho/transport"] }) })
    .use(reply)
    .bind(wsecho.output, {
        mapping: (ctx) => ({ connection: ctx["wsecho/transport"], commands: ctx.reply }),
    });

// the exposed namespaces are typed on the composition's ctx
const messages: Stream<Message<string, WsEchoAddress>> = kernel.ctx.wsecho;
const commands: Stream<Command<WsEchoAddress, string>> = kernel.ctx.reply;
void messages;
void commands;

// bound namespaces are hidden from the final ctx
// @ts-expect-error the transport was bound, not used
void kernel.ctx["wsecho/transport"];
// @ts-expect-error the output was bound, not used
void kernel.ctx["wsecho/output"];

// the transport config is required and typed
// @ts-expect-error option carrying the url is required
void createKernel().bind(wsecho.transport);
void createKernel().bind(wsecho.transport, {
    option: {
        // @ts-expect-error url must be a string
        url: 42,
    },
});

// the input's connection cannot be identity-wired: no "connection" namespace
// @ts-expect-error mapping is required when the declared input is absent
void createKernel().use(wsecho.input);

// mappings see bound namespaces too (hidden from ctx, visible to wiring)
void createKernel()
    .bind(wsecho.transport, { option: { url: "ws://localhost:1" } })
    .use(wsecho.input, {
        // @ts-expect-error the connection lives under "wsecho/transport"
        mapping: (ctx) => ({ connection: ctx["wsecho"] }),
    });

// two platforms fold side by side under distinct names
const second = wsPlatform("wsecho-b", echoSpec);
const pair = createKernel()
    .bind(wsecho.transport, { option: { url: "ws://localhost:1" } })
    .use(wsecho.input, { mapping: (ctx) => ({ connection: ctx["wsecho/transport"] }) })
    .bind(second.transport, { option: { url: "ws://localhost:2" } })
    .use(second.input, { mapping: (ctx) => ({ connection: ctx["wsecho-b/transport"] }) });
const first: Stream<Message<string, WsEchoAddress>> = pair.ctx.wsecho;
const other: Stream<Message<string, WsEchoAddress>> = pair.ctx["wsecho-b"];
void first;
void other;

// ...and reusing one name twice is rejected
void createKernel()
    .bind(wsecho.transport, { option: { url: "ws://localhost:1" } })
    // @ts-expect-error "wsecho/transport" is already taken
    .bind(second.transport, { as: "wsecho/transport", option: { url: "ws://localhost:2" } });
