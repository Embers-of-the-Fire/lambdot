/**
 * The envelope flowing through streams: a payload plus its return address.
 * The core never inspects the address beyond the `platform` routing tag.
 */
export interface Address<TPlatform extends string = string> {
    readonly platform: TPlatform;
}

/**
 * One inbound event. `payload` and `address` are platform-defined; `id` and
 * `at` are minted by the producing input (see {@link message}).
 */
export interface Message<TPayload = unknown, TAddress = unknown> {
    readonly payload: TPayload;
    readonly address: TAddress;
    /** Unique id for dedup and tracing. */
    readonly id: string;
    /** Unix epoch milliseconds. */
    readonly at: number;
}

/** Mint a message envelope with a fresh id and timestamp. */
export function message<TPayload, TAddress>(
    payload: TPayload,
    address: TAddress,
): Message<TPayload, TAddress> {
    return { payload, address, id: crypto.randomUUID(), at: Date.now() };
}

/**
 * One outbound reply: content addressed back through the platform that owns
 * the address. Features emit streams of these; output plugins consume them.
 */
export interface Command<TAddress = unknown, TContent = unknown> {
    readonly address: TAddress;
    readonly content: TContent;
}
