import type { Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

/**
 * The simplest state a composition can have: a plain `Map`, fresh per
 * application. lambdot's core is stateless — state is a plugin — and this
 * is the zero-dependency instance of that. Features declare
 * `{ state: Map<string, unknown> }` in their input and read/write it
 * directly, exactly as they would any host-native storage API.
 *
 * The store is created in `apply()`: two applications of the same
 * definition start from independent empty maps, and the state is gone when
 * the scope disposes.
 */
export function memoryState(): Plugin<void, Map<string, unknown>, void, "state"> {
    return definePlugin({
        name: "state",
        apply() {
            return new Map<string, unknown>();
        },
    });
}
