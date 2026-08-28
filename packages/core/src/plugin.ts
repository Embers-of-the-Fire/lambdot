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

/** Metadata understood by the kernel, shared by all plugin roles. */
export interface PluginMeta<TConfig> {
    readonly name: string;
    /** Capabilities that must be provided before this plugin activates. */
    readonly inject?: readonly string[];
    /** Capability names this plugin provides once active. */
    readonly provide?: string | readonly string[];
    /** Standard-Schema validator applied to config before `apply` runs. */
    readonly Config?: StandardSchemaV1<unknown, TConfig>;
}

/** Produces events of the kinds in `TEvents`. Knows how to listen, nothing else. */
export interface InputPlugin<
    TEvents extends EventMap = EventMap,
    TConfig = void,
    TName extends string = string,
> extends PluginMeta<TConfig> {
    readonly role: "input";
    readonly name: TName;
    apply(ctx: InputContext<TEvents>, config: TConfig): Effect;
}

/** Consumes addresses of its platform. Reply semantics live in `TContent`, not the core. */
export interface OutputPlugin<
    TPlatform extends string = string,
    TAddress extends Address<TPlatform> = Address<TPlatform>,
    TContent = unknown,
    TConfig = void,
    TName extends string = string,
> extends PluginMeta<TConfig> {
    readonly role: "output";
    readonly name: TName;
    readonly platform: TPlatform;
    send(to: TAddress, content: TContent): void | Promise<void>;
    apply?(ctx: ContextView<{}, {}, {}>, config: TConfig): Effect;
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
 * schema (`TStateSchema`) and context contributions (`TProvides`, phantom —
 * read back through `CtxOf` at the kernel fold).
 */
export interface FeaturePlugin<
    TNeeds extends EventMap = {},
    TSends extends OutputContractMap = {},
    TStateSchema = undefined,
    TConfig = void,
    TName extends string = string,
    _TProvides extends object = {},
> extends PluginMeta<TConfig> {
    readonly role?: "feature";
    readonly name: TName;
    apply(
        ctx: ContextView<
            TNeeds,
            TSends,
            TStateSchema extends undefined ? {} : { [K in TName]: TStateSchema }
        >,
        config: TConfig,
    ): Effect;
}

export type AnyPlugin =
    | InputPlugin<any, any, any>
    | OutputPlugin<any, any, any, any, any>
    | StatePlugin<any, any>
    | FeaturePlugin<any, any, any, any, any, any>;

/* ------------------------------------------------------------------ */
/* Type-level fold: how each plugin shapes the kernel's type params    */
/* ------------------------------------------------------------------ */

export type EventsOf<TPlugin> = TPlugin extends InputPlugin<infer TEvents, any, any> ? TEvents : {};

export type OutputsOf<TPlugin> =
    TPlugin extends OutputPlugin<infer TPlatform, infer TAddress, infer TContent, any, any>
        ? { [K in TPlatform]: OutputContract<TAddress, TContent> }
        : {};

export type StateOf<TPlugin> =
    TPlugin extends FeaturePlugin<any, any, infer TStateSchema, any, infer TName, any>
        ? TStateSchema extends undefined
            ? {}
            : { [K in TName]: TStateSchema }
        : {};

export type CtxOf<TPlugin> =
    TPlugin extends FeaturePlugin<any, any, any, any, any, infer TProvides> ? TProvides : {};

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
    TPlugin extends FeaturePlugin<infer TNeeds, any, any, any, any, any> ? TNeeds : {};
type SendsOf<TPlugin> =
    TPlugin extends FeaturePlugin<any, infer TSends, any, any, any, any> ? TSends : {};

type MissingKeys<
    TDeclared extends Record<string, any>,
    TRegistered extends Record<string, any>,
> = Exclude<keyof TDeclared & string, keyof TRegistered & string>;

/**
 * Compile-time gate on `use()`: a feature plugin can only be registered once
 * every event kind it handles and every output platform it sends through is
 * already in the fold.
 */
export type Validate<TPlugin, TEvents extends EventMap, TOutputs extends OutputContractMap> = [
    MissingKeys<NeedsOf<TPlugin>, TEvents>,
] extends [never]
    ? [MissingKeys<SendsOf<TPlugin>, TOutputs>] extends [never]
        ? unknown
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
>(plugin: FeaturePlugin<TNeeds, TSends, TStateSchema, TConfig, TName, TProvides>): typeof plugin {
    return plugin;
}
