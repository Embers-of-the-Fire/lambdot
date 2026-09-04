import type { StandardSchemaV1 } from "./schema.ts";
import type { Scope } from "./scope.ts";

/**
 * The author-facing half of a plugin: a name (its default namespace once
 * composed), an optional Standard-Schema config validator, and `apply` —
 * the function from the plugin's declared context to its item map.
 *
 * The declared input is the plugin's **full context view**: what the caller
 * seeds plus the namespaces of the dependencies it composes. A plugin that
 * reads `ctx.inner.greeting` declares `{ inner: { greeting: string } }`,
 * whether `inner` comes from the caller or from `.use(inner)`.
 */
export interface PluginSpec<TIn, TOut, TConfig, TName extends string> {
    readonly name: TName;
    readonly Config?: StandardSchemaV1<unknown, TConfig>;
    apply(input: TIn, scope: Scope, config: TConfig): TOut | Promise<TOut>;
}

/**
 * A plugin is a processor of a given context: it reads a context and
 * produces an item map. It is a definition, not a process — immutable,
 * stateless, composable. Context injection is the only composition
 * mechanism, in two forms: `use` grants the dependency the accumulated
 * context, `with` grants it a blank one. Both yield a new plugin and leave
 * the operands unchanged.
 *
 * A leaf plugin and a composed plugin are the same interface; they differ
 * only in type arguments:
 *
 * - `TIn` — the caller-facing context need: what the accumulated context
 *   must already contain for this plugin to be applied. For a leaf, the
 *   author's declared input; each composition subtracts the namespace it
 *   injects, because the dependency's item map is supplied by the
 *   composition, not seeded by the caller.
 * - `TOut` — the plugin's own item map. A plugin's own output never enters
 *   its own context; it is visible only to its caller.
 * - `TConfig` — the config schema guarding every application. A composed
 *   plugin inherits its root plugin's schema; the use-site `option` is
 *   validated against it and fed to the root's logic.
 * - `TAcc` — the namespaces injected so far, with their item-map types.
 *   Wiring bookkeeping only: it types the context a mapping can read and
 *   bounds the freshness domain for new namespaces.
 */
export interface Plugin<
    TIn = void,
    TOut = unknown,
    TConfig = void,
    TName extends string = string,
    TAcc = {},
> {
    readonly name: TName;
    readonly Config?: StandardSchemaV1<unknown, TConfig>;
    apply(input: TIn, scope: Scope, config: TConfig): TOut | Promise<TOut>;

    /**
     * Declare a contextual dependency: when applied, `dep` receives the
     * context accumulated so far — the caller-seeded context enriched with
     * the item maps of all dependencies declared before it — passed through
     * the site's `mapping`, if any. Without a mapping the accumulated
     * context is passed as-is (identity wiring); a mapping is required
     * exactly when it cannot satisfy `dep`'s declared input. `dep`'s item
     * map is injected into the accumulated context under `as` (default: its
     * name). Declaration order is observable: later `use` dependencies can
     * read everything that precedes them.
     */
    use<const TDep extends AnyPlugin, TAs extends string = NameOf<TDep>>(
        dep: TDep & FreshName<TAs, TAcc> & Compatible<OutOf<TDep>, DeclaredAt<TIn, TAs>>,
        ...args: WireArgs<TDep, InputPart<TIn> & TAcc, TAs>
    ): Plugin<Needs<TIn, TAs>, TOut, TConfig, TName, TAcc & { [K in TAs]: OutOf<TDep> }>;

    /**
     * Declare a hermetic dependency: when applied, `dep` receives a blank
     * context — its item map depends only on its own subtree and its
     * config. There is no `mapping`: the granted context is always blank,
     * so there is nothing to adapt. Consequently `dep` must declare no
     * required input (optional inputs, like a diagnostics sink, are allowed
     * and are simply absent). `dep`'s item map is injected under `as`
     * (default: its name); declaration order is irrelevant for `with`.
     */
    with<const TDep extends AnyPlugin, TAs extends string = NameOf<TDep>>(
        dep: TDep &
            FreshName<TAs, TAcc> &
            Hermetic<TDep> &
            Compatible<OutOf<TDep>, DeclaredAt<TIn, TAs>>,
        ...args: WithArgs<TDep, TAs>
    ): Plugin<Needs<TIn, TAs>, TOut, TConfig, TName, TAcc & { [K in TAs]: OutOf<TDep> }>;
}

export type AnyPlugin = Plugin<any, any, any, any, any>;

/* ------------------------------------------------------------------ */
/* Type-level plumbing                                                 */
/* ------------------------------------------------------------------ */

/** Inference helpers work structurally over `apply`, reading leaf and composed plugins alike. */
export type InOf<TUnit> = TUnit extends {
    apply(input: infer TIn, scope: any, config: any): any;
}
    ? TIn
    : never;
export type OutOf<TUnit> = TUnit extends {
    apply(input: any, scope: any, config: any): infer TOut;
}
    ? Awaited<TOut>
    : never;
export type ConfigOf<TUnit> = TUnit extends { Config?: StandardSchemaV1<any, infer TConfig> }
    ? [TConfig] extends [void]
        ? void
        : TConfig
    : TUnit extends { apply(input: any, scope: any, config: infer TConfig): any }
      ? [TConfig] extends [void]
          ? void
          : TConfig
      : void;
export type NameOf<TUnit> = TUnit extends { readonly name: infer TName extends string }
    ? TName
    : never;

/** Keys a value of `T` cannot omit. Optional inputs (e.g. a diagnostics sink) are excluded. */
type RequiredKeys<T> = {
    [K in keyof T & string]: {} extends Pick<T, K> ? never : K;
}[keyof T & string];

/** Required declared input keys absent from the visible context. */
type MissingKeys<TDeclared, TRegistered> = Exclude<
    RequiredKeys<TDeclared>,
    keyof TRegistered & string
>;

/** Declared input keys whose value types don't match the visible context. */
type MismatchedKeys<TDeclared, TRegistered> = {
    [K in keyof TDeclared & string]: K extends keyof TRegistered & string
        ? TRegistered[K] extends TDeclared[K]
            ? never
            : K
        : never;
}[keyof TDeclared & string];

/**
 * Whether identity wiring (no `mapping`) can feed a plugin expecting `TIn`
 * from the currently accumulated context: every required declared key
 * present, with a compatible value type. An optional declared key never
 * forces a mapping — its absence simply means the plugin runs without it
 * (absence means drop).
 */
type Satisfied<TIn, TAvailable> = [keyof TIn & string] extends [never]
    ? true
    : [MissingKeys<TIn, TAvailable>] extends [never]
      ? [MismatchedKeys<TIn, TAvailable>] extends [never]
          ? true
          : false
      : false;

/** Compile error marker when a namespace key is already taken in the composition. */
type FreshName<TName extends string, TTaken> = TName extends keyof TTaken & string
    ? { readonly "duplicate namespace": TName }
    : unknown;

/**
 * The author's declared input at the injected namespace, if any. When the
 * plugin's logic declares it reads `ctx[namespace]`, the dependency's
 * actual item map must be assignable to that declaration; when the logic
 * does not read the namespace, nothing is checked.
 */
type DeclaredAt<TIn, TAs extends string> = TAs extends keyof InputPart<TIn> & string
    ? InputPart<TIn>[TAs]
    : unknown;

/** Compile error marker when the dependency's item map violates the declared input. */
type Compatible<TOut, TDeclared> = TOut extends TDeclared
    ? unknown
    : { readonly "item map does not satisfy the declared input": TDeclared };

/**
 * Compile error marker when a hermetic dependency declares required input:
 * `with` grants a blank context, so anything the dependency cannot omit
 * could never be supplied.
 */
type Hermetic<TUnit extends AnyPlugin> = [RequiredKeys<InputPart<InOf<TUnit>>>] extends [never]
    ? unknown
    : {
          readonly "hermetic dependency cannot declare required input": RequiredKeys<
              InputPart<InOf<TUnit>>
          >;
      };

/** `void` inputs contribute nothing to the mapping's context type. */
type InputPart<TIn> = [TIn] extends [void] ? {} : TIn;

/**
 * The caller-facing context need after injecting a namespace: the injected
 * key is supplied by the composition, so the caller no longer provides it.
 */
type Needs<TIn, TAs extends string> = Omit<InputPart<TIn>, TAs>;

/** Adds `option` to the wire options, required exactly when the plugin's config is non-void. */
type WithOption<TUnit, TBase extends object> = [ConfigOf<TUnit>] extends [void]
    ? TBase & { option?: ConfigOf<TUnit> }
    : TBase & { option: ConfigOf<TUnit> };

/**
 * The trailing arguments of `use`. `mapping` rewires the accumulated
 * context into the dependency's declared input — required when identity
 * wiring cannot satisfy it, optional otherwise. `option` carries the
 * dependency's config, required exactly when the config type is non-void.
 * `as` renames the namespace the dependency's item map is stored under.
 */
export type WireArgs<TUnit extends AnyPlugin, TAvailable, TAs extends string> =
    Satisfied<InOf<TUnit>, TAvailable> extends true
        ? [ConfigOf<TUnit>] extends [void]
            ? [
                  options?: WithOption<
                      TUnit,
                      { mapping?: (ctx: TAvailable) => InOf<TUnit>; as?: TAs }
                  >,
              ]
            : [options: WithOption<TUnit, { mapping?: (ctx: TAvailable) => InOf<TUnit>; as?: TAs }>]
        : [options: WithOption<TUnit, { mapping: (ctx: TAvailable) => InOf<TUnit>; as?: TAs }>];

/**
 * The trailing arguments of `with`. There is no `mapping` — a hermetic
 * dependency is always granted a blank context, so there is nothing to
 * adapt. `option` carries the dependency's config, required exactly when
 * the config type is non-void. `as` renames the namespace the dependency's
 * item map is stored under.
 */
export type WithArgs<TUnit extends AnyPlugin, TAs extends string> = [ConfigOf<TUnit>] extends [void]
    ? [options?: WithOption<TUnit, { as?: TAs }>]
    : [options: WithOption<TUnit, { as?: TAs }>];
