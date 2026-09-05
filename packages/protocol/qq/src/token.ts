/**
 * A cached access token: the bearer string plus the epoch-millis instant
 * after which it must be refreshed.
 */
export interface QqToken {
    readonly token: string;
    readonly expiresAt: number;
}

/**
 * Where the client keeps its access token between fetches. Any storage can
 * back the pair — a `Map` (`@lambdot/state-memory`), SQLite, a Cloudflare
 * KV namespace, Redis — so one token can be shared across client instances
 * or survive restarts. Both halves may be sync or async; expiry checks
 * stay the client's concern. When no store is wired in, the client falls
 * back to a private in-memory cache.
 *
 * A store is scoped to one bot: sharing a store across different `appId`s
 * hands the wrong token to whichever client reads second.
 */
export interface QqTokenStore {
    /** The stored token, or undefined when absent. */
    get(): QqToken | undefined | Promise<QqToken | undefined>;
    /** Persist a freshly fetched token. */
    set(token: QqToken): void | Promise<void>;
}
