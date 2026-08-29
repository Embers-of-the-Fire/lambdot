import type { ContextView } from "./context.ts";
import type { OutputContractMap } from "./context.ts";
import { collectEffect, type Disposer } from "./effect.ts";
import { EventBus, INGRESS, type BotEvent, type OnOptions } from "./events.ts";
import type { EventMap } from "./events.ts";
import { Fiber } from "./fiber.ts";
import type {
    AnyPlugin,
    CapsOf,
    ConfigOf,
    EventsOf,
    OutputsOf,
    Spread,
    StateOf,
    Validate,
} from "./plugin.ts";
import { validateConfig } from "./schema.ts";
import { createStateAccessor, type StateBackend } from "./state.ts";

export interface KernelOptions {
    /** Sink for errors thrown by fire-and-forget listeners and disposers. */
    onError?: (error: unknown) => void;
}

/**
 * The runtime context. Untyped internally; the kernel exposes it through
 * {@link ContextView} parameterized by the folded type arguments.
 */
class RuntimeContext {
    readonly bus: EventBus;
    private readonly outputs = new Map<
        string,
        { send(to: never, content: never): void | Promise<void> }
    >();
    private readonly provided = new Map<string, unknown>();
    /** Events are processed sequentially, in ingestion order. */
    private queue: Promise<void> = Promise.resolve();
    onProvideChange: (name: string, available: boolean) => void = () => {};

    constructor(private readonly onError: (error: unknown) => void) {
        this.bus = new EventBus(onError);
    }

    on(kind: string, listener: never, options?: OnOptions): Disposer {
        return this.bus.on(kind, listener, options);
    }

    emit(kind: string, event: unknown): void {
        this.bus.emit(kind, event);
    }

    parallel(kind: string, event: unknown): Promise<void> {
        return this.bus.parallel(kind, event);
    }

    serial(kind: string, event: unknown): Promise<unknown> {
        return this.bus.serial(kind, event);
    }

    waterfall(
        kind: string,
        event: unknown,
        inner: (event: any) => Promise<unknown>,
    ): Promise<unknown> {
        return this.bus.waterfall(kind, event, inner);
    }

    async send(to: { platform: string }, content: unknown): Promise<void> {
        const output = this.outputs.get(to.platform);
        if (!output) throw new Error(`no output registered for platform "${to.platform}"`);
        await output.send(to as never, content as never);
    }

    registerOutput(
        platform: string,
        output: { send(to: never, content: never): void | Promise<void> },
    ): Disposer {
        if (this.outputs.has(platform))
            throw new Error(`duplicate output for platform "${platform}"`);
        this.outputs.set(platform, output);
        return () => {
            this.outputs.delete(platform);
        };
    }

    readonly state = {
        for: (plugin: string) => {
            // State has no dedicated runtime slot: a state plugin is an
            // ordinary feature plugin that provides its backend as the
            // (runtime-gated) "state" capability.
            const backend = this.provided.get("state") as StateBackend | undefined;
            if (!backend)
                throw new Error(
                    'no state backend active — register a state plugin and add `inject: ["state"]`',
                );
            return createStateAccessor(backend, plugin);
        },
    };

    provide(name: string, value?: unknown): Disposer {
        if (this.provided.has(name)) throw new Error(`capability "${name}" is already provided`);
        this.provided.set(name, value);
        const defined = value !== undefined && !(name in this);
        if (defined) {
            Object.defineProperty(this, name, { value, configurable: true });
        }
        this.onProvideChange(name, true);
        return () => {
            this.provided.delete(name);
            if (defined) {
                delete (this as Record<string, unknown>)[name];
            }
            this.onProvideChange(name, false);
        };
    }

    isProvided(name: string): boolean {
        return this.provided.has(name);
    }

    ingest(kind: string, payload: unknown, address: unknown): Promise<void> {
        const event: BotEvent = { kind, payload, address, id: crypto.randomUUID(), at: Date.now() };
        const run = this.queue.then(() => this.process(event));
        // A failing event rejects its own caller but never jams the queue.
        this.queue = run.catch(this.onError);
        return run;
    }

    private async process(event: BotEvent): Promise<void> {
        await this.bus.waterfall(INGRESS, event, async (current: BotEvent) => {
            await this.bus.parallel(current.kind, current);
        });
    }
}

interface FiberEntry {
    readonly plugin: AnyPlugin;
    readonly config: unknown;
    readonly fiber: Fiber;
}

/**
 * The kernel. Stateless: it owns no conversational data, only the fiber
 * registry and the runtime wiring. Every `use()` folds the plugin's type
 * contribution into the kernel's type parameters — the context type your
 * plugins see is computed from the plugins you registered.
 */
export class Kernel<
    TEvents extends EventMap = {},
    TOutputs extends OutputContractMap = {},
    TCaps extends object = {},
    TState extends object = {},
> {
    /** The typed context. This is the fold of everything registered so far. */
    readonly ctx: ContextView<TEvents, TOutputs, TState, TCaps> & TCaps;

    private readonly runtime: RuntimeContext;
    private readonly entries: FiberEntry[] = [];
    private readonly onError: (error: unknown) => void;
    private readonly inflightActivations = new Set<Promise<void>>();
    private started = false;

    constructor(options: KernelOptions = {}) {
        this.onError = options.onError ?? ((error) => console.error("[lambdot]", error));
        this.runtime = new RuntimeContext(this.onError);
        this.runtime.onProvideChange = (name, available) => {
            if (!available) void this.deactivateDependents(name).catch(this.onError);
            if (available) void this.activateEligible().catch(this.onError);
        };
        this.ctx = this.runtime as unknown as ContextView<TEvents, TOutputs, TState, TCaps> & TCaps;
    }

    /**
     * Register a plugin. Gated at compile time: every event kind a feature
     * handles, every output platform it sends through, and every typed
     * capability it injects must already be in the fold.
     */
    use<TPlugin extends AnyPlugin>(
        plugin: TPlugin & Validate<TPlugin, TEvents, TOutputs, TCaps>,
        ...config: Spread<ConfigOf<TPlugin>>
    ): Kernel<
        TEvents & EventsOf<TPlugin>,
        TOutputs & OutputsOf<TPlugin>,
        TCaps & CapsOf<TPlugin>,
        TState & StateOf<TPlugin>
    > {
        const entry: FiberEntry = {
            plugin,
            config: config[0],
            fiber: new Fiber(plugin, config[0]),
        };
        this.entries.push(entry);
        if (this.started) void this.activateEligible().catch(this.onError);
        return this as unknown as Kernel<
            TEvents & EventsOf<TPlugin>,
            TOutputs & OutputsOf<TPlugin>,
            TCaps & CapsOf<TPlugin>,
            TState & StateOf<TPlugin>
        >;
    }

    /** Activate all plugins whose `inject` requirements are satisfiable. */
    async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        await this.activateEligible();
        const stuck = this.entries
            .filter((entry) => entry.fiber.state === "pending")
            .map((entry) => entry.plugin.name);
        if (stuck.length > 0)
            console.warn(`[lambdot] plugins pending on missing capabilities: ${stuck.join(", ")}`);
    }

    /** Dispose every active fiber in reverse registration order. */
    async stop(): Promise<void> {
        this.started = false;
        for (const entry of [...this.entries].reverse()) {
            await entry.fiber.dispose("disposed", this.onError);
        }
    }

    private eligible(plugin: AnyPlugin): boolean {
        return (plugin.inject ?? []).every((name) => this.runtime.isProvided(name));
    }

    private async activateEligible(): Promise<void> {
        if (!this.started) return;
        let progressed = true;
        while (progressed) {
            progressed = false;
            for (const entry of this.entries) {
                if (entry.fiber.state !== "pending" || !this.eligible(entry.plugin)) continue;
                await this.activate(entry);
                progressed = true;
            }
        }
        // Nested passes (triggered by `provide` during activation) may still
        // have activations in flight; wait for quiescence so `start()` and
        // `stop()` only observe settled fibers.
        while (this.inflightActivations.size > 0) {
            await Promise.allSettled(this.inflightActivations);
        }
    }

    private activate(entry: FiberEntry): Promise<void> {
        // Mark the fiber synchronously so a nested `activateEligible` pass
        // cannot pick it up again while activation is in flight.
        entry.fiber.state = "activating";
        const activation = this.completeActivation(entry);
        this.inflightActivations.add(activation);
        const settled = () => this.inflightActivations.delete(activation);
        activation.then(settled, settled);
        return activation;
    }

    private async completeActivation(entry: FiberEntry): Promise<void> {
        const { plugin, fiber } = entry;
        let config = entry.config;
        try {
            if (plugin.Config) config = await validateConfig(plugin.name, plugin.Config, config);
        } catch (error) {
            fiber.state = "pending";
            throw error;
        }
        // The kernel may have stopped, or a required capability may have been
        // withdrawn, while we awaited; mid-activation fibers are invisible to
        // `deactivateDependents` and `stop`.
        if (!this.started || !this.eligible(plugin)) {
            fiber.state = "pending";
            return;
        }

        // Role-specific registration happens before `apply` so plugin code
        // can rely on its own capability being live.
        if (plugin.role === "output") {
            fiber.state = "active";
            fiber.addDisposer(this.runtime.registerOutput(plugin.platform, plugin));
        } else {
            fiber.state = "active";
        }

        if ("apply" in plugin && plugin.apply) {
            await collectEffect(plugin.apply(this.runtime as never, config as never), (disposer) =>
                fiber.addDisposer(disposer),
            );
        }

        const provides = plugin.provide ? [plugin.provide].flat() : [];
        for (const name of provides) {
            fiber.addDisposer(this.runtime.provide(name));
        }
    }

    private async deactivateDependents(capability: string): Promise<void> {
        for (const entry of [...this.entries].reverse()) {
            if (entry.fiber.state !== "active") continue;
            if (!(entry.plugin.inject ?? []).includes(capability)) continue;
            await entry.fiber.dispose("pending", this.onError);
        }
    }
}

/** Create an empty kernel. Fold plugins in with `.use(...)`. */
export function createKernel(options?: KernelOptions): Kernel {
    return new Kernel(options);
}
