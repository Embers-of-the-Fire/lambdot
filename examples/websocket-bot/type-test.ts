/**
 * Compile-time assertions for the connection-service pattern, mirroring
 * echo-bot/type-test.ts: mapping-based wiring and namespace visibility
 * through the `@lambdot/websocket` plugin — including two connections in
 * one composition.
 */
import { createScope, definePlugin } from "@lambdot/core";
import { wsConnection, type WsConnection } from "@lambdot/websocket";

const echo = definePlugin({
    name: "echo",
    apply(input: { socket: WsConnection }, scope) {
        scope.onDispose(input.socket.listen((data) => input.socket.push(`echo: ${data}`)));
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(wsConnection("socket"), { option: { url: "ws://localhost:1" } })
    .use(echo);

// apply returns the root's own item map; the connection is input-side
// scaffolding and does not propagate to the caller
const items: {} = await app.apply({}, createScope(), undefined);
void items;

// the connection config is required and typed
// @ts-expect-error option carrying the url is required
void definePlugin({ name: "bare", apply: () => ({}) }).with(wsConnection("socket"));
void definePlugin({ name: "bare", apply: () => ({}) }).with(wsConnection("socket"), {
    option: {
        // @ts-expect-error url must be a string
        url: 42,
    },
});

// the feature cannot be identity-wired before the connection exists
// @ts-expect-error mapping is required when the declared input is absent
void definePlugin({ name: "bare", apply: () => ({}) }).use(echo);

// mappings are checked against the namespaces visible at that point
void definePlugin({ name: "bare", apply: () => ({}) }).use(echo, {
    // @ts-expect-error "socket" is not composed yet
    mapping: (ctx) => ({ socket: ctx.socket }),
});

// a hermetic dependency cannot declare required input: with grants a blank
// context, so echo's "socket" could never be supplied
// @ts-expect-error echo requires "socket"
void definePlugin({ name: "bare", apply: () => ({}) }).with(echo);

// two connections fold side by side under distinct names, each feature
// wiring its own through its mapping
const pair = definePlugin({ name: "pair", apply: () => ({}) })
    .with(wsConnection("socket-a"), { option: { url: "ws://localhost:1" } })
    .with(wsConnection("socket-b"), { option: { url: "ws://localhost:2" } })
    .use(echo, { as: "echo-a", mapping: (ctx) => ({ socket: ctx["socket-a"] }) })
    .use(echo, { as: "echo-b", mapping: (ctx) => ({ socket: ctx["socket-b"] }) });
void pair;

// ...and reusing one name twice is rejected
const oneSocket = definePlugin({ name: "bare", apply: () => ({}) }).with(wsConnection("socket"), {
    option: { url: "ws://localhost:1" },
});
// @ts-expect-error "socket" is already taken
void oneSocket.with(wsConnection("socket"), { option: { url: "ws://localhost:2" } });
