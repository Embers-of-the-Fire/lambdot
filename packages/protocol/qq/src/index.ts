import type { FeaturePlugin, InputPlugin, OutputPlugin } from "@lambdot/core";
import type { WsCapability } from "@lambdot/websocket";

import { qqApi, type QqApiConfig, type QqCapability } from "./api.ts";
import type { QqEnvNeeds } from "./credentials.ts";
import type { QqAddress, QqEvents } from "./events.ts";
import { qqGatewayInput, qqGatewayTransport, type QqGatewayInputConfig } from "./gateway.ts";
import { qqOutput } from "./output.ts";
import { qqWebhookInput, type QqWebhookCapability, type QqWebhookConfig } from "./webhook.ts";

export { qqApi, type QqApi, type QqApiConfig, type QqCapability } from "./api.ts";
export {
    DEFAULT_QQ_CREDENTIAL_KEYS,
    readQqCredentials,
    type QqCredentialKeys,
    type QqCredentials,
    type QqEnvNeeds,
} from "./credentials.ts";
export {
    decodeMessageEvent,
    type QqAddress,
    type QqEvents,
    type QqMessage,
    type QqOutputs,
} from "./events.ts";
export {
    QQ_INTENT_GROUP_AND_C2C,
    qqGatewayInput,
    qqGatewayTransport,
    type QqGatewayInputConfig,
} from "./gateway.ts";
export { qqOutput } from "./output.ts";
export {
    qqWebhookInput,
    type QqWebhook,
    type QqWebhookCapability,
    type QqWebhookConfig,
} from "./webhook.ts";

/**
 * One qq platform over the websocket gateway, bundled: the REST client, the
 * gateway transport that discovers the socket URL through it, the receiving
 * input, and the shared output. The pieces stay separate (rather than one
 * fused plugin) so the type fold can keep enforcing registration order:
 * env provider → api → transport → input → output → features.
 *
 * ```ts
 * const qq = qqGatewayPlatform({ ws: "qq-ws", api: "qq-api", env: "qq-env" });
 * createKernel()
 *     .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
 *     .use(qq.api, {})
 *     .use(qq.transport)
 *     .use(qq.input, {})
 *     .use(qq.output);
 * ```
 */
export interface QqGatewayPlatform<
    TWsCap extends string,
    TApiCap extends string,
    TEnvCap extends string,
> {
    readonly api: FeaturePlugin<
        {},
        {},
        undefined,
        QqApiConfig,
        `qq-api:${TApiCap}`,
        QqCapability<TApiCap>,
        QqEnvNeeds<TEnvCap>
    >;
    readonly transport: FeaturePlugin<
        {},
        {},
        undefined,
        void,
        `qq-gateway-transport:${TWsCap}`,
        WsCapability<TWsCap>,
        QqCapability<TApiCap>
    >;
    readonly input: InputPlugin<
        QqEvents,
        QqGatewayInputConfig,
        "qq-gateway-input",
        {},
        WsCapability<TWsCap> & QqCapability<TApiCap>
    >;
    readonly output: OutputPlugin<
        "qq",
        QqAddress,
        string,
        void,
        "qq-output",
        {},
        QqCapability<TApiCap>
    >;
}

/** Build a whole gateway-backed qq platform from its capability names. */
export function qqGatewayPlatform<
    TWsCap extends string,
    TApiCap extends string,
    TEnvCap extends string,
>(capabilities: {
    readonly ws: TWsCap;
    readonly api: TApiCap;
    readonly env: TEnvCap;
}): QqGatewayPlatform<TWsCap, TApiCap, TEnvCap> {
    return {
        api: qqApi(capabilities.api, capabilities.env),
        transport: qqGatewayTransport(capabilities.ws, capabilities.api),
        input: qqGatewayInput(capabilities.ws, capabilities.api),
        output: qqOutput(capabilities.api),
    };
}

/**
 * One qq platform over the webhook (reversed-post) infra, bundled: the
 * webhook input that provides the callback-handler capability, the REST
 * client, and the output. Registration order: env provider → webhook → api →
 * output → features.
 *
 * ```ts
 * const qq = qqWebhookPlatform({ webhook: "qq-webhook", api: "qq-api", env: "qq-env" });
 * createKernel()
 *     .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
 *     .use(qq.webhook, {})
 *     .use(qq.api, {})
 *     .use(qq.output);
 * // in the hono route: return kernel.ctx["qq-webhook"].handle(c.req.raw);
 * ```
 */
export interface QqWebhookPlatform<
    TCap extends string,
    TApiCap extends string,
    TEnvCap extends string,
> {
    readonly webhook: InputPlugin<
        QqEvents,
        QqWebhookConfig,
        `qq-webhook:${TCap}`,
        QqWebhookCapability<TCap>,
        QqEnvNeeds<TEnvCap>
    >;
    readonly api: FeaturePlugin<
        {},
        {},
        undefined,
        QqApiConfig,
        `qq-api:${TApiCap}`,
        QqCapability<TApiCap>,
        QqEnvNeeds<TEnvCap>
    >;
    readonly output: OutputPlugin<
        "qq",
        QqAddress,
        string,
        void,
        "qq-output",
        {},
        QqCapability<TApiCap>
    >;
}

/** Build a whole webhook-backed qq platform from its capability names. */
export function qqWebhookPlatform<
    TCap extends string,
    TApiCap extends string,
    TEnvCap extends string,
>(capabilities: {
    readonly webhook: TCap;
    readonly api: TApiCap;
    readonly env: TEnvCap;
}): QqWebhookPlatform<TCap, TApiCap, TEnvCap> {
    return {
        webhook: qqWebhookInput(capabilities.webhook, capabilities.env),
        api: qqApi(capabilities.api, capabilities.env),
        output: qqOutput(capabilities.api),
    };
}
