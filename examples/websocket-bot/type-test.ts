/**
 * Compile-time assertions for the generic-transport pattern, mirroring
 * echo-bot/type-test.ts: the fold and the registration gate must keep
 * working through the generic `@lambdot/websocket` factories — including
 * with two websocket transports in one kernel.
 */
import { createKernel, definePlugin } from "@lambdot/core";
import {
    wsInput,
    wsOutput,
    wsPlatform,
    wsTransport,
    type WsCapability,
    type WsConnection,
} from "@lambdot/websocket";

import { echoSpec, type EchoEvents, type EchoOutputs } from "./echo-spec.ts";

const reply = definePlugin<EchoEvents, EchoOutputs>({
    name: "reply",
    apply(ctx) {
        return ctx.on("wsecho.message", (event) => {
            // payload is typed string
            const text: string = event.payload;
            return ctx.send(event.address, `echo: ${text}`);
        });
    },
});

const kernel = createKernel()
    .use(wsTransport("ws"), { url: "ws://localhost:1" })
    .use(wsInput("ws", echoSpec))
    .use(wsOutput("ws", echoSpec))
    .use(reply);

// the transport's provided service is typed on the folded kernel context
const connection: WsConnection = kernel.ctx.ws;
void connection;

// send checks content against the folded ws platform contract
void kernel.ctx.send({ platform: "wsecho" }, "ok");
// @ts-expect-error wsecho content is string, not an object
void kernel.ctx.send({ platform: "wsecho" }, { text: "nope" });

// send rejects addresses of unregistered platforms
// @ts-expect-error no "discord" output is registered
void kernel.ctx.send({ platform: "discord", channel: "123" }, "hello");

// handlers can only subscribe to registered event kinds
// @ts-expect-error "discord.message" was never registered by an input
void kernel.ctx.on("discord.message", () => {});

// registration order is enforced through the generic factories
// @ts-expect-error unregistered event kinds / output platforms
void createKernel().use(reply);

// the input alone satisfies neither the capability nor the output platform
// @ts-expect-error unprovided capabilities
void createKernel().use(wsInput("ws", echoSpec)).use(reply);

// typed capability injection is gated: the transport must register first
// @ts-expect-error unprovided capabilities
void createKernel().use(wsInput("ws", echoSpec));

// the transport config is required and typed
// @ts-expect-error url is required
void createKernel().use(wsTransport("ws"));

// two transports with distinct capability names fold side by side
const twoTransports = createKernel()
    .use(wsTransport("ws-a"), { url: "ws://localhost:1" })
    .use(wsTransport("ws-b"), { url: "ws://localhost:2" });
const connA: WsConnection = twoTransports.ctx["ws-a"];
const connB: WsConnection = twoTransports.ctx["ws-b"];
void connA;
void connB;

// each platform's plugins gate on their own transport's capability
void createKernel()
    .use(wsTransport("ws-a"), { url: "ws://localhost:1" })
    // @ts-expect-error "ws-b" is not in the fold yet
    .use(wsInput("ws-b", echoSpec));

// the bundled combinator: one declaration per platform, same fold behavior
const wsecho = wsPlatform("ws", echoSpec);
const bundled = createKernel()
    .use(wsecho.transport, { url: "ws://localhost:1" })
    .use(wsecho.input)
    .use(wsecho.output)
    .use(reply);
const bundledConnection: WsConnection = bundled.ctx.ws;
void bundledConnection;
void bundled.ctx.send({ platform: "wsecho" }, "ok");

// the bundle does not bypass the registration gate
// @ts-expect-error the transport must register before the input that injects it
void createKernel().use(wsecho.input);

// injected capability value types are checked against the fold
const wrongCaps = definePlugin<{}, {}, undefined, void, string, {}, { ws: number }>({
    name: "wrong-caps",
    inject: ["ws"],
    apply: () => {},
});
// @ts-expect-error ws is a WsConnection, not a number
void createKernel().use(wsTransport("ws"), { url: "ws://localhost:1" }).use(wrongCaps);

// with typed TInjects declared, inject is restricted to the declared names
void definePlugin<{}, {}, undefined, void, string, {}, WsCapability<"ws">>({
    name: "bad-inject",
    // @ts-expect-error "state" is not a declared capability need
    inject: ["state"],
    apply: () => {},
});

// provide is type-checked against the declaring plugin's TProvides
void definePlugin<{}, {}, undefined, void, string, WsCapability<"ws">>({
    name: "bad-provider",
    apply(ctx) {
        ctx.provide("ws", connection);
        // @ts-expect-error the ws capability requires a WsConnection value
        ctx.provide("ws", 42);
        // undeclared names stay on the runtime-only path
        ctx.provide("metrics");
    },
});
