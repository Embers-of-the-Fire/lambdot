import type {
    Address,
    ContextView,
    InputContext,
    OutputContract,
    OutputContractMap,
} from "./context.ts";
import type { Effect } from "./effect.ts";
import type { EventMap } from "./events.ts";
import type { StandardSchemaV1 } from "./schema.ts";
import type { StateBackend } from "./state.ts";

/**
 * The `inject` requirement: once a plugin declares typed capability needs
 * (`TInjects`), the runtime `inject` array is restricted to exactly those
 * names — the runtime gate and the type-level gate cannot drift apart.
 * Plugins with no declared needs keep the loose string form (the
 * runtime-only capability path, e.g. `inject: ["state"]`).
 */
type InjectNames<TInjects extends object> = [keyof TInjects & string] extends [never]
    ? readonly string[]
    : readonly (keyof TInjects & string)[];

/** Metadata understood by the kernel, shared by all plugin roles. */
export interface PluginMeta<TConfig, TInjects extends object = {}> {
    readonly name: string;
    /** Capabilities that must be provided before this plugin activates. */
    readonly inject?: InjectNames<TInjects>;
    /**
     * Capability names this plugin provides once active. Provided valueless
     * by the kernel after `apply`; to provide a typed value, declare
     * `TProvides` and call `ctx.provide(name, value)` in `apply` instead.
     */
    readonly provide?: string | readonly string[];
    /** Standard-Schema validator applied to config before `apply` runs. */
    readonly Config?: StandardSchemaV1<unknown, TConfig>;
}

/**
 * Produces events of the kinds in `TEvents`. Knows how to listen, nothing
 * else. May declare typed capabilities it provides (`TProvides`) and
 * consumes (`TInjects` — folded into its `apply` context, gated at `use()`).
 */
export interface InputPlugin<
    TEvents extends EventMap = EventMap,
    TConfig = void,
    TName extends string = string,
    TProvides extends object = {},
    TInjects extends object = {},
> extends PluginMeta<TConfig, TInjects> {
    readonly role: "input";
    readonly name: TName;
    apply(ctx: InputContext<TEvents, TProvides> & TInjects, config: TConfig): Effect;
}

/** Consumes addresses of its platform. Reply semantics live in `TContent`, not the core. */
export interface OutputPlugin<
    TPlatform extends string = string,
    TAddress extends Address<TPlatform> = Address<TPlatform>,
    TContent = unknown,
    TConfig = void,
    TName extends string = string,
    TProvides extends object = {},
    TInjects extends object = {},
> extends PluginMeta<TConfig, TInjects> {
    readonly role: "output";
    readonly name: TName;
    readonly platform: TPlatform;
    send(to: TAddress, content: TContent): void | Promise<void>;
    apply?(ctx: ContextView<{}, {}, {}, TProvides> & TInjects, config: TConfig): Effect;
}

/** Provides the `state` capability via its backend. At most one may be active. */
export interface StatePlugin<
    TConfig = void,
    TName extends string = string,
> extends PluginMeta<TConfig> {
    readonly role: "state";
    readonly name: TName;
    readonly backend: StateBackend;
    apply?(ctx: ContextView<{}, {}, {}>, config: TConfig): Effect;
}

/**
 * A unit of behavior. Declares the event kinds it handles (`TNeeds`), the
 * output platforms it sends through (`TSends`), and optionally a state
 * schema (`TStateSchema`) and typed capabilities: `TProvides` (read back
 * through `CapsOf` at the kernel fold; `provide` is type-checked against
 * it) and `TInjects` (folded into the `apply` context; the kernel checks
 * at `use()` time that the fold so far provides them).
 */
export interface FeaturePlugin<
    TNeeds extends EventMap = {},
    TSends extends OutputContractMap = {},
    TStateSchema = undefined,
    TConfig = void,
    TName extends string = string,
    TProvides extends object = {},
    TInjects extends object = {},
> extends PluginMeta<TConfig, TInjects> {
    readonly role?: "feature";
    readonly name: TName;
    apply(
        ctx: ContextView<
            TNeeds,
            TSends,
            TStateSchema extends undefined ? {} : { [K in TName]: TStateSchema },
            TProvides
        > &
            TInjects,
        config: TConfig,
    ): Effect;
}

export type AnyPlugin =
    | InputPlugin<any, any, any, any, any>
    | OutputPlugin<any, any, any, any, any, any, any>
    | StatePlugin<any, any>
    | FeaturePlugin<any, any, any, any, any, any, any>;

/* ------------------------------------------------------------------ */
/* Type-level fold: how each plugin shapes the kernel's type params    */
/* ------------------------------------------------------------------ */

export type EventsOf<TPlugin> =
    TPlugin extends InputPlugin<infer TEvents, any, any, any, any> ? TEvents : {};

export type OutputsOf<TPlugin> =
    TPlugin extends OutputPlugin<
        infer TPlatform,
        infer TAddress,
        infer TContent,
        any,
        any,
        any,
        any
    >
        ? { [K in TPlatform]: OutputContract<TAddress, TContent> }
        : {};

export type StateOf<TPlugin> =
    TPlugin extends FeaturePlugin<any, any, infer TStateSchema, any, infer TName, any, any>
        ? TStateSchema extends undefined
            ? {}
            : { [K in TName]: TStateSchema }
        : {};

/** Typed capabilities a plugin provides, folded into the kernel's `TCaps`. */
export type CapsOf<TPlugin> =
    TPlugin extends FeaturePlugin<any, any, any, any, any, infer TProvides, any>
        ? TProvides
        : TPlugin extends InputPlugin<any, any, any, infer TProvides, any>
          ? TProvides
          : TPlugin extends OutputPlugin<any, any, any, any, any, infer TProvides, any>
            ? TProvides
            : {};

/** Typed capabilities a plugin consumes, gated against the fold at `use()`. */
export type InjectsOf<TPlugin> =
    TPlugin extends FeaturePlugin<any, any, any, any, any, any, infer TInjects>
        ? TInjects
        : TPlugin extends InputPlugin<any, any, any, any, infer TInjects>
          ? TInjects
          : TPlugin extends OutputPlugin<any, any, any, any, any, any, infer TInjects>
            ? TInjects
            : {};

/** Config type: from the schema if present, else from `apply`'s second parameter. */
export type ConfigOf<TPlugin> = TPlugin extends { Config: StandardSchemaV1<any, infer TOutput> }
    ? TOutput
    : TPlugin extends { apply: (ctx: any, config: infer TConfig) => any }
      ? unknown extends TConfig
          ? void
          : TConfig
      : void;

/** Makes the config argument optional exactly when `void` is assignable to it. */
export type Spread<T> = [T] extends [void] ? [config?: T] : [config: T];

type NeedsOf<TPlugin> =
    TPlugin extends FeaturePlugin<infer TNeeds, any, any, any, any, any, any> ? TNeeds : {};
type SendsOf<TPlugin> =
    TPlugin extends FeaturePlugin<any, infer TSends, any, any, any, any, any> ? TSends : {};

type MissingKeys<TDeclared extends object, TRegistered extends object> = Exclude<
    keyof TDeclared & string,
    keyof TRegistered & string
>;

/** Declared capability keys whose value types don't match the folded capability. */
type MismatchedKeys<TDeclared extends object, TRegistered extends object> = {
    [K in keyof TDeclared & string]: K extends keyof TRegistered & string
        ? TDeclared[K] extends TRegistered[K]
            ? never
            : K
        : never;
}[keyof TDeclared & string];

/**
 * Compile-time gate on `use()`: a plugin can only be registered once every
 * event kind it handles, every output platform it sends through, and every
 * typed capability it injects is already in the fold — with a compatible
 * value type.
 */
export type Validate<
    TPlugin,
    TEvents extends EventMap,
    TOutputs extends OutputContractMap,
    TCaps extends object,
> = [MissingKeys<NeedsOf<TPlugin>, TEvents>] extends [never]
    ? [MissingKeys<SendsOf<TPlugin>, TOutputs>] extends [never]
        ? [MissingKeys<InjectsOf<TPlugin>, TCaps>] extends [never]
            ? [MismatchedKeys<InjectsOf<TPlugin>, TCaps>] extends [never]
                ? unknown
                : {
                      readonly "mismatched capability types": MismatchedKeys<
                          InjectsOf<TPlugin>,
                          TCaps
                      >;
                  }
            : { readonly "unprovided capabilities": MissingKeys<InjectsOf<TPlugin>, TCaps> }
        : { readonly "unregistered output platforms": MissingKeys<SendsOf<TPlugin>, TOutputs> }
    : { readonly "unregistered event kinds": MissingKeys<NeedsOf<TPlugin>, TEvents> };

/** Identity helper for authoring feature plugins with precise generics. */
export function definePlugin<
    TNeeds extends EventMap = {},
    TSends extends OutputContractMap = {},
    TStateSchema = undefined,
    TConfig = void,
    TName extends string = string,
    TProvides extends object = {},
    TInjects extends object = {},
>(
    plugin: FeaturePlugin<TNeeds, TSends, TStateSchema, TConfig, TName, TProvides, TInjects>,
): typeof plugin {
    return plugin;
}
