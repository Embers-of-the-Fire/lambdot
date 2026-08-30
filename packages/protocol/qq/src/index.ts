import type { Plugin } from "@lambdot/core";
import type { WsConnection } from "@lambdot/websocket";

import { qqApi, type QqApi, type QqApiConfig } from "./api.ts";
import type { QqCommandStream, QqMessageStream } from "./events.ts";
import { qqGatewayInput, qqGatewayTransport, type QqGatewayInputConfig } from "./gateway.ts";
import { qqOutput } from "./output.ts";
import { qqWebhook, type QqWebhook, type QqWebhookConfig } from "./webhook.ts";

export { qqApi, type QqApi, type QqApiConfig } from "./api.ts";
export {
    DEFAULT_QQ_CREDENTIAL_KEYS,
    readQqCredentials,
    type QqCredentialKeys,
    type QqCredentials,
} from "./credentials.ts";
export {
    decodeMessageEvent,
    type QqAddress,
    type QqCommandStream,
    type QqMessage,
    type QqMessageStream,
} from "./events.ts";
export {
    QQ_INTENT_GROUP_AND_C2C,
    qqGatewayInput,
    qqGatewayTransport,
    type QqGatewayInputConfig,
} from "./gateway.ts";
export { qqOutput } from "./output.ts";
export { qqWebhook, type QqWebhook, type QqWebhookConfig } from "./webhook.ts";

/**
 * One qq platform over the websocket gateway, bundled as leaves. The api and
 * transport are internal wiring (compose them with `bind`); the input's
 * message stream is exposed under the platform name (compose with `use`).
 * The output is terminal, so it is always wired last:

 * ```ts
 * const qq = qqGatewayPlatform("qq");
 * createKernel()
 *     .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
 *     .bind(qq.api, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
 *     .bind(qq.transport, { mapping: (ctx) => ({ api: ctx["qq/api"] }) })
 *     .use(qq.input, {
 *         option: {},
 *         mapping: (ctx) => ({ connection: ctx["qq/transport"], api: ctx["qq/api"] }),
 *     })
 *     .use(reply, { mapping: (ctx) => ({ messages: ctx.qq }) })
 *     .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });
 * ```
 */
export interface QqGatewayPlatform<TName extends string> {
    readonly api: Plugin<
        { env: Readonly<Record<string, string>> },
        QqApi,
        QqApiConfig,
        `${TName}/api`
    >;
    readonly transport: Plugin<{ api: QqApi }, WsConnection, void, `${TName}/transport`>;
    readonly input: Plugin<
        { connection: WsConnection; api: QqApi },
        QqMessageStream,
        QqGatewayInputConfig,
        TName
    >;
    readonly output: Plugin<
        { api: QqApi; commands: QqCommandStream },
        void,
        void,
        `${TName}/output`
    >;
}

/** Build a whole gateway-backed qq platform under one name. */
export function qqGatewayPlatform<const TName extends string>(
    name: TName,
): QqGatewayPlatform<TName> {
    return {
        api: qqApi(`${name}/api`),
        transport: qqGatewayTransport(`${name}/transport`),
        input: qqGatewayInput(name),
        output: qqOutput(`${name}/output`),
    };
}

/**
 * One qq platform over the webhook (reversed-post) infra, bundled as leaves.
 * The webhook is exposed under the platform name — its `handle` serves the
 * HTTP callback route, its `messages` stream feeds the features. The api is
 * internal wiring; the output is terminal:

 * ```ts
 * const qq = qqWebhookPlatform("qq");
 * createKernel()
 *     .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
 *     .use(qq.webhook, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
 *     .bind(qq.api, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
 *     .use(reply, { mapping: (ctx) => ({ messages: ctx.qq.messages }) })
 *     .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });
 * // in the hono route: return kernel.ctx.qq.handle(c.req.raw);
 * ```
 */
export interface QqWebhookPlatform<TName extends string> {
    readonly webhook: Plugin<
        { env: Readonly<Record<string, string>> },
        QqWebhook,
        QqWebhookConfig,
        TName
    >;
    readonly api: Plugin<
        { env: Readonly<Record<string, string>> },
        QqApi,
        QqApiConfig,
        `${TName}/api`
    >;
    readonly output: Plugin<
        { api: QqApi; commands: QqCommandStream },
        void,
        void,
        `${TName}/output`
    >;
}

/** Build a whole webhook-backed qq platform under one name. */
export function qqWebhookPlatform<const TName extends string>(
    name: TName,
): QqWebhookPlatform<TName> {
    return {
        webhook: qqWebhook(name),
        api: qqApi(`${name}/api`),
        output: qqOutput(`${name}/output`),
    };
}
