import type { Disposer } from "./effect.ts";
import type { StandardSchemaV1 } from "./schema.ts";

/**
 * Per-activation services handed to a plugin's `apply`: collect disposers
 * (run when the owning plugin unloads, in reverse order) and report errors
 * from background work (stream pumps, timers).
 */
export interface Scope {
    onDispose(disposer: Disposer): void;
    onError(error: unknown): void;
}

/**
 * The author-facing half of a plugin: a name (its namespace key once
 * composed), an optional Standard-Schema config validator, and `apply` —
 * the function from the plugin's declared input to its emitted output.
 */
export interface PluginSpec<TIn, TOut, TConfig, TName extends string> {
    readonly name: TName;
    readonly Config?: StandardSchemaV1<unknown, TConfig>;
    apply(input: TIn, scope: Scope, config: TConfig): TOut | Promise<TOut>;
}

/**
 * A plugin is a function: `apply` maps its declared input (`TIn`, a record
 * of namespaces it consumes) to its output (`TOut`, the value it emits).
 * Composition methods (`use`/`bind`) build bigger plugins out of smaller
 * ones; `start`/`stop`/`ctx` make any plugin runnable on its own.
 */
export interface Plugin<TIn = void, TOut = unknown, TConfig = void, TName extends string = string> {
    readonly name: TName;
    readonly Config?: StandardSchemaV1<unknown, TConfig>;
    apply(input: TIn, scope: Scope, config: TConfig): TOut | Promise<TOut>;

    /** Feed `unit` from the visible context and expose its output under `as` (default: its name). */
    use<const TUnit extends AnyUnit, TAs extends string = NameOf<TUnit>>(
        unit: TUnit & FreshName<TAs, { [K in TName]: TOut }>,
        ...args: WireArgs<TUnit, InputPart<TIn> & { [K in TName]: TOut }, TAs>
    ): Composite<TIn, { [K in TName]: TOut } & { [K in TAs]: OutOf<TUnit> }, {}, TName>;

    /** Like {@link use}, but the unit's output stays internal to the composition. */
    bind<const TUnit extends AnyUnit, TAs extends string = NameOf<TUnit>>(
        unit: TUnit & FreshName<TAs, { [K in TName]: TOut }>,
        ...args: WireArgs<TUnit, InputPart<TIn> & { [K in TName]: TOut }, TAs>
    ): Composite<TIn, { [K in TName]: TOut }, { [K in TAs]: OutOf<TUnit> }, TName>;

    start(...args: StartArgs<TIn>): Promise<void>;
    stop(): Promise<void>;
    /** The exposed namespaces. Populated during `start`; typed regardless. */
    readonly ctx: { [K in TName]: TOut };
}

/**
 * A composed chain of plugins — itself wireable like a plugin: its input is
 * the chain's external requirement, its output is the visible context
 * (`TVisible`). `THidden` carries the `bind`-encapsulated namespaces:
 * visible to later `mapping`s inside the chain, absent from the final `ctx`.
 * Structural sibling of {@link Plugin} (the conditional wire types do not
 * survive interface extension).
 */
export interface Composite<TIn = void, TVisible = {}, THidden = {}, TName extends string = string> {
    readonly name: TName;
    apply(input: TIn, scope: Scope, config: void): Promise<TVisible>;

    use<const TUnit extends AnyUnit, TAs extends string = NameOf<TUnit>>(
        unit: TUnit & FreshName<TAs, TVisible & THidden>,
        ...args: WireArgs<TUnit, InputPart<TIn> & TVisible & THidden, TAs>
    ): Composite<TIn, TVisible & { [K in TAs]: OutOf<TUnit> }, THidden, TName>;

    bind<const TUnit extends AnyUnit, TAs extends string = NameOf<TUnit>>(
        unit: TUnit & FreshName<TAs, TVisible & THidden>,
        ...args: WireArgs<TUnit, InputPart<TIn> & TVisible & THidden, TAs>
    ): Composite<TIn, TVisible, THidden & { [K in TAs]: OutOf<TUnit> }, TName>;

    start(...args: StartArgs<TIn>): Promise<void>;
    stop(): Promise<void>;
    readonly ctx: TVisible;
}

export type AnyUnit = Plugin<any, any, any, any> | Composite<any, any, any, any>;

/** The kernel is a composition seeded empty: `createKernel().use(...)`. */
export type Kernel<TVisible = {}, THidden = {}> = Composite<void, TVisible, THidden, "kernel">;

/* ------------------------------------------------------------------ */
/* Type-level plumbing                                                 */
/* ------------------------------------------------------------------ */

/**
 * Inference helpers work structurally over `apply`, so they read both leaf
 * plugins and composites (which carry no declared config — `void`).
 */
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

type MissingKeys<TDeclared, TRegistered> = Exclude<
    keyof TDeclared & string,
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
 * Whether identity wiring (no `mapping`) can feed a unit expecting `TIn`
 * from the currently visible context: every declared key present, with a
 * compatible value type.
 */
type Satisfied<TIn, TAvailable> = [keyof TIn & string] extends [never]
    ? true
    : [MissingKeys<TIn, TAvailable>] extends [never]
      ? [MismatchedKeys<TIn, TAvailable>] extends [never]
          ? true
          : false
      : false;

/** Compile error marker when a namespace key is already taken in the chain. */
type FreshName<TName extends string, TTaken> = TName extends keyof TTaken & string
    ? { readonly "duplicate namespace": TName }
    : unknown;

/** `void` inputs contribute nothing to the mapping's context type. */
type InputPart<TIn> = [TIn] extends [void] ? {} : TIn;

/** Adds `option` to the wire options, required exactly when the unit's config is non-void. */
type WithOption<TUnit, TBase extends object> = [ConfigOf<TUnit>] extends [void]
    ? TBase & { option?: ConfigOf<TUnit> }
    : TBase & { option: ConfigOf<TUnit> };

/**
 * The trailing arguments of `use`/`bind`. `mapping` rewires the visible
 * context into the unit's declared input — required when identity wiring
 * cannot satisfy it, optional otherwise. `option` carries the unit's
 * config, required exactly when the config type is non-void. `as` renames
 * the namespace the unit's output is stored under.
 */
export type WireArgs<TUnit extends AnyUnit, TAvailable, TAs extends string> =
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

/** `start` takes the composition's external input exactly when it declares one. */
export type StartArgs<TIn> = [TIn] extends [void] ? [] : [input: TIn];
