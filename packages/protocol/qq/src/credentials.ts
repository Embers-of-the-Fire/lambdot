/**
 * The env-capability view the qq plugins declare as `TInjects`: any
 * string-keyed snapshot of variables. `@lambdot/env`'s
 * `EnvCapability<TCap, TKey>` narrows the keys but stays assignable to this,
 * so the fold's capability-type check accepts it.
 */
export type QqEnvNeeds<TEnvCap extends string> = {
    readonly [K in TEnvCap]: Readonly<Record<string, string>>;
};

/** The bot credentials issued by the QQ open platform. */
export interface QqCredentials {
    readonly appId: string;
    readonly clientSecret: string;
}

/** Which env variables carry the credentials (overridable per plugin config). */
export interface QqCredentialKeys {
    readonly appId: string;
    readonly clientSecret: string;
}

export const DEFAULT_QQ_CREDENTIAL_KEYS: QqCredentialKeys = {
    appId: "QQ_BOT_APP_ID",
    clientSecret: "QQ_BOT_APP_SECRET",
};

/** Read the credentials out of an env snapshot, failing loudly when absent. */
export function readQqCredentials(
    env: Readonly<Record<string, string>>,
    keys: QqCredentialKeys = DEFAULT_QQ_CREDENTIAL_KEYS,
): QqCredentials {
    const appId = env[keys.appId];
    const clientSecret = env[keys.clientSecret];
    if (!appId || !clientSecret)
        throw new Error(
            `qq credentials missing: "${keys.appId}" and "${keys.clientSecret}" must both be set`,
        );
    return { appId, clientSecret };
}
