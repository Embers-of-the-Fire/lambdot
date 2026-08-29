/**
 * The slice of the workers built-in module this example uses, declared
 * locally because the repo types against Node, not `@cloudflare/workers-types`
 * (the same structural-subset philosophy as the package's binding types).
 * workerd resolves `cloudflare:workers` at runtime; esbuild leaves the
 * import external. This file must stay a global script — no top-level
 * imports — or `declare module` becomes a no-op augmentation.
 */
declare module "cloudflare:workers" {
    export class DurableObject<Env = unknown> {
        protected readonly ctx: import("@lambdot/host-cloudflare").DurableObjectState;
        protected readonly env: Env;
        constructor(ctx: import("@lambdot/host-cloudflare").DurableObjectState, env: Env);
    }
}
