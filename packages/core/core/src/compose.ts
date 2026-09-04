import type { Plugin, PluginSpec } from "./plugin.ts";
import { validateConfig, type StandardSchemaV1 } from "./schema.ts";
import { runDisposers, type Disposer, type Scope } from "./scope.ts";

/** Runtime view of any plugin: a leaf definition or a nested composition. */
interface RuntimePlugin {
    readonly name: string;
    readonly Config?: StandardSchemaV1<unknown, unknown> | undefined;
    apply(input: unknown, scope: Scope, config: unknown): Promise<unknown>;
}

interface Entry {
    readonly unit: RuntimePlugin;
    /** The namespace key the unit's item map is stored under (`as` ?? name). */
    readonly key: string;
    /** Hermetic (`with`) entries are granted a blank context and carry no mapping. */
    readonly hermetic: boolean;
    readonly mapping: ((ctx: Record<string, unknown>) => unknown) | undefined;
    /** The use-site config, validated against the unit's declared schema. */
    readonly option: unknown;
}

interface WireOptions {
    readonly mapping?: (ctx: Record<string, unknown>) => unknown;
    readonly option?: unknown;
    readonly as?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function entryOf(unit: RuntimePlugin, options: WireOptions | undefined, hermetic: boolean): Entry {
    return {
        unit,
        key: options?.as ?? unit.name,
        hermetic,
        mapping: options?.mapping,
        option: options?.option,
    };
}

/** Buffer disposers registered by one application; error reports pass through. */
function childScopeOf(scope: Scope, disposers: Disposer[]): Scope {
    return {
        onDispose: (disposer) => {
            disposers.push(disposer);
        },
        onError: (error) => scope.onError(error),
    };
}

/**
 * A leaf plugin at runtime — a bare definition. `apply` validates the
 * supplied config against the declared schema (if any) and runs the spec's
 * logic over the given context. `use` and `with` seed a composition with
 * the plugin as its root; the leaf is left unchanged.
 */
class LeafRuntime implements RuntimePlugin {
    readonly name: string;

    constructor(private readonly spec: PluginSpec<any, any, any, string>) {
        this.name = spec.name;
    }

    get Config(): StandardSchemaV1<unknown, unknown> | undefined {
        return this.spec.Config;
    }

    async apply(input: unknown, scope: Scope, config: unknown): Promise<unknown> {
        const validated = this.Config
            ? await validateConfig(this.name, this.Config, config)
            : config;
        return await this.spec.apply(input, scope, validated);
    }

    use(dep: RuntimePlugin, options?: WireOptions): ComposedRuntime {
        return new ComposedRuntime(this, [entryOf(dep, options, false)]);
    }

    with(dep: RuntimePlugin, options?: WireOptions): ComposedRuntime {
        return new ComposedRuntime(this, [entryOf(dep, options, true)]);
    }
}

/**
 * A composed plugin at runtime — a root leaf plus an immutable list of
 * dependency entries in declaration order. `use` and `with` return a new
 * composed plugin with the entry appended; the receiver is left unchanged,
 * so composing twice from the same base yields two independent plugins.
 */
class ComposedRuntime implements RuntimePlugin {
    constructor(
        private readonly root: LeafRuntime,
        private readonly entries: readonly Entry[],
    ) {}

    get name(): string {
        return this.root.name;
    }

    /** A composed plugin inherits its root's config schema. */
    get Config(): StandardSchemaV1<unknown, unknown> | undefined {
        return this.root.Config;
    }

    use(dep: RuntimePlugin, options?: WireOptions): ComposedRuntime {
        return new ComposedRuntime(this.root, [...this.entries, entryOf(dep, options, false)]);
    }

    with(dep: RuntimePlugin, options?: WireOptions): ComposedRuntime {
        return new ComposedRuntime(this.root, [...this.entries, entryOf(dep, options, true)]);
    }

    /**
     * Apply the composition: seed the accumulated context from the given
     * context, apply each dependency in declaration order — `use` entries
     * to the accumulated context (through the site's mapping, if any),
     * `with` entries to a blank context — injecting each item map under its
     * namespace, then run the root's own logic over the final accumulated
     * context and return its item map. The plugin's own item map never
     * enters its own context; the accumulated context is input-side
     * scaffolding and does not propagate to the caller.
     *
     * On success, every application's teardown is registered onto the
     * caller's scope in application order — the scope's LIFO discipline
     * then unwinds the root first and the dependencies in reverse,
     * mirroring the dependency order in which resources were acquired. On
     * failure, everything already applied is disposed in reverse order and
     * the failure propagates; no partial resources are left behind.
     */
    async apply(input: unknown, scope: Scope, config: unknown): Promise<unknown> {
        const ctx: Record<string, unknown> = isRecord(input) ? { ...input } : {};
        const activated: Disposer[][] = [];
        try {
            for (const entry of this.entries) {
                if (entry.key in ctx) throw new Error(`duplicate namespace "${entry.key}"`);
                const disposers: Disposer[] = [];
                // A snapshot per entry, so mappings and dependencies cannot
                // mutate the scaffolding later entries (and the root) read.
                const available = { ...ctx };
                const depInput = entry.hermetic
                    ? {}
                    : entry.mapping
                      ? entry.mapping(available)
                      : available;
                const output = await entry.unit.apply(
                    depInput,
                    childScopeOf(scope, disposers),
                    entry.option,
                );
                ctx[entry.key] = output;
                activated.push(disposers);
            }
            // The plugin's own logic runs last, over the final accumulated
            // context. Its config is validated now — after the dependencies,
            // immediately before the logic runs.
            const rootDisposers: Disposer[] = [];
            activated.push(rootDisposers);
            const own = await this.root.apply(
                { ...ctx },
                childScopeOf(scope, rootDisposers),
                config,
            );
            for (const disposers of activated) {
                scope.onDispose(() => runDisposers(disposers, (error) => scope.onError(error)));
            }
            return own;
        } catch (error) {
            // Reversing the application-order concatenation disposes entries
            // in reverse order, each entry's own disposers LIFO.
            await runDisposers(
                activated.flatMap((disposers) => disposers),
                (disposalError) => scope.onError(disposalError),
            );
            throw error;
        }
    }
}

/**
 * Author a plugin. The spec is just `name`, optional `Config` schema, and
 * `apply`; the returned plugin carries the composers (`use` and `with`).
 * Composition is non-destructive: `A.use(B)` / `A.with(B)` leave `A`
 * unchanged and reusable.
 *
 * Call without explicit type arguments: the name infers as a literal (it
 * becomes the dependency's default namespace), and the input/output/config
 * types infer from `apply`'s annotations and the `Config` schema. Supplying
 * any explicit argument silently defaults the rest, erasing that precision.
 */
export function definePlugin<const TName extends string, TIn = void, TOut = void, TConfig = void>(
    spec: PluginSpec<TIn, TOut, TConfig, TName>,
): Plugin<TIn, TOut, TConfig, TName> {
    return new LeafRuntime(spec) as never;
}
