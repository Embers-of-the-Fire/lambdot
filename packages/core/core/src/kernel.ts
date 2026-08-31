import { runDisposers, type Disposer } from "./effect.ts";
import type { Composite, Plugin, PluginSpec, Scope } from "./plugin.ts";
import { validateConfig } from "./schema.ts";

export interface KernelOptions {
    /** Sink for errors reported through `scope.onError` and background activations. */
    onError?: (error: unknown) => void;
}

/** Runtime view of anything wireable: a leaf plugin or a nested composition. */
interface RuntimeUnit {
    readonly name: string;
    activate(input: unknown, scope: Scope, config: unknown): Promise<unknown>;
}

interface Entry {
    readonly unit: RuntimeUnit;
    /** The namespace key the unit's output is stored under (`as` ?? name). */
    readonly key: string;
    readonly visible: boolean;
    readonly mapping: ((ctx: Record<string, unknown>) => unknown) | undefined;
    readonly config: unknown;
}

const defaultOnError = (error: unknown): void => console.error("[lambdot]", error);

function makeScope(disposers: Disposer[], onError: (error: unknown) => void): Scope {
    return {
        onDispose: (disposer) => {
            disposers.push(disposer);
        },
        onError,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * A leaf plugin at runtime. The composition methods seed an artifact chain
 * with the plugin itself as the first entry, so a lone plugin is runnable.
 */
class PluginRuntime implements RuntimeUnit {
    private artifact: CompositeRuntime | undefined;

    constructor(private readonly spec: PluginSpec<any, any, any, string>) {
        this.name = spec.name;
    }

    readonly name: string;

    get Config(): PluginSpec<any, any, any, string>["Config"] {
        return this.spec.Config;
    }

    apply(input: unknown, scope: Scope, config: unknown): Promise<unknown> {
        return this.activate(input, scope, config);
    }

    async activate(input: unknown, scope: Scope, config: unknown): Promise<unknown> {
        const validated = this.spec.Config
            ? await validateConfig(this.spec.name, this.spec.Config, config)
            : config;
        return await this.spec.apply(input, scope, validated);
    }

    use(unit: RuntimeUnit, options?: WireOptions): CompositeRuntime {
        return this.asArtifact().use(unit, options);
    }

    bind(unit: RuntimeUnit, options?: WireOptions): CompositeRuntime {
        return this.asArtifact().bind(unit, options);
    }

    start(input?: unknown): Promise<void> {
        return this.asArtifact().start(input);
    }

    async stop(): Promise<void> {
        await this.artifact?.stop();
    }

    get ctx(): Record<string, unknown> {
        return this.asArtifact().ctx;
    }

    private asArtifact(): CompositeRuntime {
        if (!this.artifact) {
            this.artifact = new CompositeRuntime(
                [
                    {
                        unit: this,
                        key: this.spec.name,
                        visible: true,
                        mapping: undefined,
                        config: undefined,
                    },
                ],
                {},
                this.spec.name,
            );
        }
        return this.artifact;
    }
}

interface WireOptions {
    readonly mapping?: (ctx: Record<string, unknown>) => unknown;
    readonly option?: unknown;
    readonly as?: string;
}

/**
 * A composition at runtime. Inert while built: `start` activates the entries
 * in composition order — resolve the mapping (or identity-wire the visible
 * context), activate the unit, stash its output under its namespace key —
 * and `stop` disposes in reverse. Activation order is definition order;
 * ordering mistakes are compile errors in the mappings, not runtime states.
 */
class CompositeRuntime implements RuntimeUnit {
    readonly ctx: Record<string, unknown> = {};
    private readonly hidden: Record<string, unknown> = {};
    private readonly activated: { entry: Entry; disposers: Disposer[] }[] = [];
    private inputRecord: Record<string, unknown> = {};
    private started = false;
    private readonly onError: (error: unknown) => void;

    constructor(
        private readonly entries: Entry[],
        options: KernelOptions,
        readonly name: string,
    ) {
        this.onError = options.onError ?? defaultOnError;
    }

    /** Set by `expose`: composing onto a sealed chain is a runtime error. */
    private exposed: string | undefined;

    use(unit: RuntimeUnit, options?: WireOptions): this {
        return this.add(unit, options, true);
    }

    bind(unit: RuntimeUnit, options?: WireOptions): this {
        return this.add(unit, options, false);
    }

    /** Seal the chain and return it as a named engine — the final artifact. */
    expose(name: string): EngineRuntime {
        // Explicit undefined check: "" is a valid name and must still seal.
        if (this.exposed !== undefined)
            throw new Error(`kernel already exposed as engine "${this.exposed}"`);
        this.exposed = name;
        return new EngineRuntime(this, name);
    }

    private add(unit: RuntimeUnit, options: WireOptions | undefined, visible: boolean): this {
        if (this.exposed !== undefined)
            throw new Error(`cannot compose onto a kernel exposed as engine "${this.exposed}"`);
        const entry: Entry = {
            unit,
            key: options?.as ?? unit.name,
            visible,
            mapping: options?.mapping,
            config: options?.option,
        };
        this.entries.push(entry);
        // Composing onto a running artifact activates in the background —
        // same fire-and-report semantics as composition before `start`.
        if (this.started) void this.activateEntry(entry).catch(this.onError);
        return this;
    }

    /** RuntimeUnit: run as a nested unit, torn down with the parent. */
    async activate(input: unknown, scope: Scope, _config: unknown): Promise<unknown> {
        scope.onDispose(() => this.stop());
        await this.start(input);
        return this.ctx;
    }

    async start(input?: unknown): Promise<void> {
        if (this.started) return;
        this.started = true;
        this.inputRecord = isRecord(input) ? input : {};
        try {
            for (const entry of this.entries) {
                if (this.activated.some((done) => done.entry === entry)) continue;
                await this.activateEntry(entry);
            }
        } catch (error) {
            await this.stop();
            throw error;
        }
    }

    async stop(): Promise<void> {
        this.started = false;
        for (const { entry, disposers } of this.activated.splice(0).reverse()) {
            await runDisposers(disposers, this.onError);
            if (entry.visible) delete this.ctx[entry.key];
            else delete this.hidden[entry.key];
        }
    }

    private async activateEntry(entry: Entry): Promise<void> {
        if (entry.key in this.ctx || entry.key in this.hidden)
            throw new Error(`duplicate namespace "${entry.key}"`);
        const disposers: Disposer[] = [];
        // Identity wiring hands over the whole visible context; the unit's
        // declared input type narrows the view at compile time.
        const wireCtx = { ...this.inputRecord, ...this.hidden, ...this.ctx };
        const input = entry.mapping ? entry.mapping(wireCtx) : wireCtx;
        const output = await entry.unit.activate(
            input,
            makeScope(disposers, this.onError),
            entry.config,
        );
        if (entry.visible) this.ctx[entry.key] = output;
        else this.hidden[entry.key] = output;
        this.activated.push({ entry, disposers });
    }
}

/**
 * The runtime behind `Composite.expose`: a thin, sealed façade over the
 * chain. Lifecycle delegates to the inner composition; as a nested unit it
 * activates exactly like the chain itself — the only difference is the name
 * and the erased type.
 */
class EngineRuntime implements RuntimeUnit {
    constructor(
        private readonly inner: CompositeRuntime,
        readonly name: string,
    ) {}

    /** Public contract: apply the engine directly, like any other unit. */
    apply(input: unknown, scope: Scope, config: unknown): Promise<unknown> {
        return this.activate(input, scope, config);
    }

    activate(input: unknown, scope: Scope, _config: unknown): Promise<unknown> {
        return this.inner.activate(input, scope, undefined);
    }

    start(input?: unknown): Promise<void> {
        return this.inner.start(input);
    }

    stop(): Promise<void> {
        return this.inner.stop();
    }

    get ctx(): Record<string, unknown> {
        return this.inner.ctx;
    }
}

/**
 * Author a plugin. The spec is just `name`, optional `Config` schema, and
 * `apply`; the returned plugin carries the composition methods (`use`,
 * `bind`, `start`, `stop`, `ctx`).
 */
export function definePlugin<
    TIn = void,
    TOut = void,
    TConfig = void,
    TName extends string = string,
>(spec: PluginSpec<TIn, TOut, TConfig, TName>): Plugin<TIn, TOut, TConfig, TName> {
    return new PluginRuntime(spec) as never;
}

/** Create an empty composition. Wire plugins in with `.use(...)` / `.bind(...)`. */
export function createKernel(options?: KernelOptions): Composite<void, {}, {}, "kernel"> {
    return new CompositeRuntime([], options ?? {}, "kernel") as never;
}
