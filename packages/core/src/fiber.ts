import { runDisposers, type Disposer } from "./effect.ts";
import type { AnyPlugin } from "./plugin.ts";

export type FiberState = "pending" | "activating" | "active" | "disposed";

/**
 * One plugin application. Owns the disposers the plugin's effects produced.
 * A fiber whose injected capabilities disappear is disposed back to
 * `pending`, and reactivates when they return — activation order is derived
 * from `inject`, never from boot sequencing.
 */
export class Fiber {
    state: FiberState = "pending";
    private readonly disposers: Disposer[] = [];

    constructor(
        readonly plugin: AnyPlugin,
        readonly config: unknown,
    ) {}

    get name(): string {
        return this.plugin.name;
    }

    addDisposer(disposer: Disposer): void {
        if (this.state !== "active") {
            throw new Error(`cannot register disposer on ${this.state} fiber "${this.name}"`);
        }
        this.disposers.push(disposer);
    }

    async dispose(
        nextState: "pending" | "disposed",
        onError: (error: unknown) => void,
    ): Promise<void> {
        if (this.state !== "active") return;
        this.state = nextState;
        const disposers = this.disposers.splice(0);
        await runDisposers(disposers, onError);
    }
}
