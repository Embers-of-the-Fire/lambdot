/**
 * Structural subsets of Cloudflare's worker binding types (normally supplied
 * by `@cloudflare/workers-types`). Declared locally so the package stays
 * dependency-free: real bindings from a worker's `env` are assignable to
 * these interfaces structurally, and anything the platform adds beyond them
 * (sessions, metadata options, ...) stays available to consumers through
 * their own types.
 */

/* ------------------------------ Workers KV ------------------------------- */

/** Options accepted by {@link KVNamespace.list}. */
export interface KVListOptions {
    readonly prefix?: string;
    readonly limit?: number;
    readonly cursor?: string;
}

/** One entry returned by {@link KVNamespace.list}. */
export interface KVListKey {
    readonly name: string;
    readonly expiration?: number;
}

/** One page from {@link KVNamespace.list}. */
export interface KVListResult {
    readonly keys: readonly KVListKey[];
    readonly list_complete: boolean;
    /** Present only while more pages remain. */
    readonly cursor?: string;
}

/** Write options accepted by {@link KVNamespace.put}. */
export interface KVPutOptions {
    /** Relative TTL in seconds. Cloudflare enforces a 60-second minimum. */
    readonly expirationTtl?: number;
    /** Absolute expiry, seconds since the epoch. Same 60-second floor. */
    readonly expiration?: number;
}

/**
 * The fundamental slice of a Workers KV namespace: JSON and text reads,
 * string writes with optional expiry, delete, and listing.
 */
export interface KVNamespace {
    /** Read a key, parsing the stored value as JSON. `null` on a miss. */
    get(key: string, options: { type: "json" }): Promise<unknown>;
    /** Read a key as text. `null` on a miss. */
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: KVPutOptions): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: KVListOptions): Promise<KVListResult>;
}

/* ---------------------------------- D1 ----------------------------------- */

/** The outcome of a D1 statement that returns rows. */
export interface D1Result<T = unknown> {
    readonly results: T[];
    readonly success: boolean;
    readonly meta: Record<string, unknown>;
    readonly error?: string;
}

/** The outcome of `D1Database.exec` (schema migrations, bulk statements). */
export interface D1ExecResult {
    readonly count: number;
    readonly duration: number;
}

/** A prepared D1 statement. */
export interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    /** The first row (or one column of it), `null` when the statement matched nothing. */
    first<T = unknown>(column?: string): Promise<T | null>;
    run<T = unknown>(): Promise<D1Result<T>>;
    all<T = unknown>(): Promise<D1Result<T>>;
    raw<T = unknown>(): Promise<T[]>;
}

/** The fundamental slice of a D1 database. */
export interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<D1ExecResult>;
}

/* ---------------------------------- R2 ----------------------------------- */

/** Values an R2 bucket accepts on `put`. */
export type R2PutValue = string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob;

/** Write options accepted by {@link R2Bucket.put}. */
export interface R2PutOptions {
    readonly customMetadata?: Record<string, string>;
}

/** Metadata of an object stored in R2. */
export interface R2Object {
    readonly key: string;
    readonly size: number;
    readonly etag: string;
    readonly uploaded: Date;
    readonly customMetadata?: Record<string, string>;
}

/** An R2 object together with its body. */
export interface R2ObjectBody extends R2Object {
    readonly body: ReadableStream;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

/** Options accepted by {@link R2Bucket.list}. */
export interface R2ListOptions {
    readonly prefix?: string;
    readonly limit?: number;
    readonly cursor?: string;
    readonly delimiter?: string;
}

/** One page from {@link R2Bucket.list}. */
export interface R2Objects {
    readonly objects: readonly R2Object[];
    readonly truncated: boolean;
    /** Present only while more pages remain. */
    readonly cursor?: string;
    readonly delimitedPrefixes: readonly string[];
}

/** The fundamental slice of an R2 bucket. */
export interface R2Bucket {
    get(key: string): Promise<R2ObjectBody | null>;
    put(key: string, value: R2PutValue, options?: R2PutOptions): Promise<R2Object | null>;
    delete(keys: string | readonly string[]): Promise<void>;
    list(options?: R2ListOptions): Promise<R2Objects>;
}

/* ---------------------------- Durable Objects ---------------------------- */

/** A Durable Object id, minted by a {@link DurableObjectNamespace}. */
export interface DurableObjectId {
    toString(): string;
    equals(other: DurableObjectId): boolean;
}

/** A stub talking to one Durable Object instance: the fetch entry only. */
export interface DurableObjectStub {
    fetch(request: Request): Promise<Response>;
}

/**
 * The fundamental slice of a Durable Object namespace binding: name an
 * instance, then talk to it through its stub.
 */
export interface DurableObjectNamespace {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
}

/**
 * The fundamental slice of a Durable Object's transactional storage:
 * per-instance, structured-cloneable values, no JSON round trip needed.
 */
export interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
}

/** The slice of a Durable Object's constructor state the framework builds on. */
export interface DurableObjectState {
    readonly storage: DurableObjectStorage;
}
