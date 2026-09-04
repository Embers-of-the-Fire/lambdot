import assert from "node:assert/strict";
import test from "node:test";

import type { AnyPlugin, StandardSchemaV1 } from "./index.ts";
import { ConfigValidationError, createScope, definePlugin } from "./index.ts";

const stringSchema: StandardSchemaV1<unknown, string> = {
    "~standard": {
        version: 1,
        vendor: "test",
        validate: (value) =>
            typeof value === "string" ? { value } : { issues: [{ message: "expected string" }] },
    },
};

void test("leaf apply returns its own item map and validates config", async () => {
    const seen: unknown[] = [];
    const greet = definePlugin({
        name: "greet",
        Config: stringSchema,
        apply: (_input, _scope, config) => {
            seen.push(config);
            return { greeting: "hello" };
        },
    });

    const output = await greet.apply(undefined, createScope(), "hi");
    assert.deepEqual(output, { greeting: "hello" });
    assert.deepEqual(seen, ["hi"]);

    await assert.rejects(async () => {
        await greet.apply(undefined, createScope(), 42 as unknown as string);
    }, ConfigValidationError);
});

/* Spec §4.1 — with: hermetic dependency. */
void test("with grants a blank context; only the plugin's own item map is returned", async () => {
    const granted: unknown[] = [];
    const b = definePlugin({
        name: "B",
        apply: (input: Record<string, unknown>) => {
            granted.push({ ...input });
            return { answer: 42 };
        },
    });
    const a = definePlugin({
        name: "A",
        apply: (ctx: { B: { answer: number } }) => ({ greeting: `answer:${ctx.B.answer}` }),
    });

    const p = a.with(b);
    const output = await p.apply({ seeded: true }, createScope(), undefined);
    // B was granted a blank context — not the caller-seeded one.
    assert.deepEqual(granted, [{}]);
    // A processed a context containing B, but P's caller sees only A's own
    // item map: B's contribution was input-side scaffolding.
    assert.deepEqual(output, { greeting: "answer:42" });
});

/* Spec §4.2 — use: contextual dependency, order is observable. */
void test("declaration order is observable for use and irrelevant for with", async () => {
    const b = definePlugin({ name: "B", apply: () => ({ answer: 42 }) });
    const c = definePlugin({
        name: "C",
        apply: (ctx: Record<string, unknown>) => ({ seen: Object.keys(ctx) }),
    });
    const seen: string[][] = [];
    const a = definePlugin({
        name: "A",
        apply: (ctx: { C: { seen: string[] } }) => {
            seen.push(ctx.C.seen);
            return { done: true };
        },
    });

    await a.with(b).use(c).apply({}, createScope(), undefined);
    await a.use(c).with(b).apply({ origin: "caller" }, createScope(), undefined);
    // `use` reads everything that precedes it — including the
    // caller-seeded context; `with` seals B away either way.
    assert.deepEqual(seen, [["B"], ["origin"]]);
});

/* Spec §4.3 — caller-provided context and mapping. */
void test("use grants the accumulated context; mapping reshapes it to the declared input", async () => {
    const counterGranted: Record<string, unknown>[] = [];
    const state = definePlugin({
        name: "state",
        apply: () => {
            let value = 0;
            return {
                get: () => value,
                set: (next: number) => {
                    value = next;
                },
            };
        },
    });
    const counter = definePlugin({
        name: "counter",
        apply: (ctx: { "counter-source": { get(): number; set(next: number): void } }) => {
            counterGranted.push({ ...ctx });
            return {
                increment: () => ctx["counter-source"].set(ctx["counter-source"].get() + 1),
                value: () => ctx["counter-source"].get(),
            };
        },
    });
    const app = definePlugin({
        name: "app",
        apply: (ctx: { env: string; counter: { increment(): void; value(): number } }) => ({
            run: () => {
                ctx.counter.increment();
                return { env: ctx.env, value: ctx.counter.value() };
            },
        }),
    })
        .with(state)
        .use(counter, { mapping: (ctx) => ({ "counter-source": ctx.state }) });

    const output = await app.apply({ env: "prod" }, createScope(), undefined);
    // The mapping reshaped the accumulated context: counter saw exactly its
    // declared input, not the caller-provided `env`.
    assert.deepEqual(
        counterGranted.map((ctx) => Object.keys(ctx)),
        [["counter-source"]],
    );
    // The app's own logic ran over the final accumulated context.
    assert.deepEqual(output.run(), { env: "prod", value: 1 });
});

/* Spec §4.4 — abstract plugin and handler (meta behavior). */
void test("an abstract plugin is connected to its handler at the composition site", async () => {
    const lines: string[] = [];
    const logToConsole = definePlugin({
        name: "logToConsole",
        apply: () => ({
            write: (line: string) => {
                lines.push(line);
            },
        }),
    });
    const logger = definePlugin({
        name: "logger",
        apply: (ctx: { sink: { write(line: string): void } }) => ({
            log: (message: string) => ctx.sink.write(message),
        }),
    });
    const app = definePlugin({
        name: "app",
        apply: (ctx: { logger: { log(message: string): void } }) => ({
            run: () => ctx.logger.log("hi"),
        }),
    })
        .with(logToConsole)
        .use(logger, { mapping: (ctx) => ({ sink: ctx.logToConsole }) });

    const output = await app.apply({}, createScope(), undefined);
    output.run();
    assert.deepEqual(lines, ["hi"]);
});

/* Spec §4.5 — nesting: a composed plugin is a plugin. */
void test("a composed plugin's whole item map nests under one namespace of the parent", async () => {
    const b = definePlugin({ name: "B", apply: () => ({ answer: 42 }) });
    const a = definePlugin({
        name: "A",
        apply: (ctx: { B: { answer: number } }) => ({ greeting: `answer:${ctx.B.answer}` }),
    });
    const inner = a.with(b);
    const outer = definePlugin({
        name: "outer",
        apply: (ctx: { inner: { greeting: string } }) => ({ text: ctx.inner.greeting }),
    }).use(inner, { as: "inner" });

    const output = await outer.apply({}, createScope(), undefined);
    assert.deepEqual(output, { text: "answer:42" });
});

/* Spec §4.6 — diagnostics: the handler decision belongs to downstream. */
void test("an optional sink never forces a mapping; absence means drop", async () => {
    const records: string[] = [];
    const logToConsole = definePlugin({
        name: "logToConsole",
        apply: () => ({
            write: (record: string) => {
                records.push(record);
            },
        }),
    });
    const foo = definePlugin({
        name: "foo",
        apply: (ctx: { sink?: { write(record: string): void } }) => ({
            work: () => ctx.sink?.write("working"),
        }),
    });

    // Downstream decides to handle: the sink is wired through a mapping.
    const app = definePlugin({
        name: "app",
        apply: (ctx: { foo: { work(): void } }) => ({ run: () => ctx.foo.work() }),
    })
        .with(logToConsole)
        .use(foo, { mapping: (ctx) => ({ sink: ctx.logToConsole }) });
    (await app.apply({}, createScope(), undefined)).run();
    assert.deepEqual(records, ["working"]);

    // Downstream decides not to: identity wiring stays valid (the sink is
    // optional), and emissions are dropped silently.
    records.length = 0;
    const silent = definePlugin({
        name: "silent",
        apply: (ctx: { foo: { work(): void } }) => ({ run: () => ctx.foo.work() }),
    }).use(foo);
    (await silent.apply({}, createScope(), undefined)).run();
    assert.deepEqual(records, []);
});

/* Spec §4.6 — diagnostics do not propagate implicitly. */
void test("a nested emitter's logs reach the handler only if each layer forwards them", async () => {
    const records: string[] = [];
    const logToConsole = definePlugin({
        name: "logToConsole",
        apply: () => ({
            write: (record: string) => {
                records.push(record);
            },
        }),
    });
    const foo = definePlugin({
        name: "foo",
        apply: (ctx: { sink?: { write(record: string): void } }) => ({
            work: () => ctx.sink?.write("working"),
        }),
    });
    // bar opts in to forwarding its own optional sink to foo.
    const bar = definePlugin({
        name: "bar",
        apply: (ctx: { sink?: { write(record: string): void }; foo: { work(): void } }) => ({
            run: () => ctx.foo.work(),
        }),
    }).use(foo, { mapping: (ctx) => (ctx.sink ? { sink: ctx.sink } : {}) });
    const app = definePlugin({
        name: "app",
        apply: (ctx: { bar: { run(): void } }) => ({ main: () => ctx.bar.run() }),
    })
        .with(logToConsole)
        .use(bar, { mapping: (ctx) => ({ sink: ctx.logToConsole }) });
    (await app.apply({}, createScope(), undefined)).main();
    assert.deepEqual(records, ["working"]);

    // Without bar's forwarding mapping, foo's emissions are dropped even
    // though the app registered a handler: identity wiring never shapes the
    // handler into foo's declared `sink` input on its own.
    records.length = 0;
    const barSilent = definePlugin({
        name: "bar",
        apply: (ctx: { foo: { work(): void } }) => ({ run: () => ctx.foo.work() }),
    }).use(foo);
    const appSilent = definePlugin({
        name: "app",
        apply: (ctx: { bar: { run(): void } }) => ({ main: () => ctx.bar.run() }),
    })
        .with(logToConsole)
        .use(barSilent);
    (await appSilent.apply({}, createScope(), undefined)).main();
    assert.deepEqual(records, []);
});

void test("composition is non-destructive: the base stays unchanged and reusable", async () => {
    const base = definePlugin({
        name: "base",
        apply: (ctx: Record<string, unknown>) => ({ keys: Object.keys(ctx) }),
    });
    const px = definePlugin({ name: "px", apply: () => ({ v: 1 }) });
    const py = definePlugin({ name: "py", apply: () => ({ v: 2 }) });

    const bx = base.use(px);
    const by = base.use(py);

    assert.deepEqual(await base.apply({}, createScope(), undefined), { keys: [] });
    assert.deepEqual(await bx.apply({}, createScope(), undefined), { keys: ["px"] });
    assert.deepEqual(await by.apply({}, createScope(), undefined), { keys: ["py"] });
});

void test("a duplicate namespace is rejected at application time", async () => {
    const host = definePlugin({ name: "host", apply: () => ({}) });
    const first = definePlugin({ name: "dup", apply: () => ({ v: 1 }) });
    // Typed as AnyPlugin to model a dynamically-constructed composition,
    // which the static freshness check cannot see.
    const second: AnyPlugin = definePlugin({ name: "dup", apply: () => ({ v: 2 }) });

    const composed = host.use(first).use(second);
    await assert.rejects(async () => {
        await composed.apply({}, createScope(), undefined);
    }, /duplicate namespace "dup"/);
});

void test("a failed application disposes activated dependencies in reverse and propagates", async () => {
    const events: string[] = [];
    const errors: unknown[] = [];
    const makeOk = <const TName extends string>(name: TName) =>
        definePlugin({
            name,
            apply: (_input: void, scope) => {
                scope.onDispose(() => {
                    events.push(`dispose-${name}`);
                });
                return { name };
            },
        });
    const boom = definePlugin({
        name: "boom",
        apply: (): { v: number } => {
            throw new Error("boom");
        },
    });

    const root = definePlugin({ name: "root", apply: () => ({ r: 1 }) });
    const composed = root.use(makeOk("ok1")).use(makeOk("ok2")).use(boom);
    const scope = createScope({ onError: (error) => errors.push(error) });
    await assert.rejects(async () => {
        await composed.apply({}, scope, undefined);
    }, /boom/);
    assert.deepEqual(events, ["dispose-ok2", "dispose-ok1"]);

    // Nothing was registered on the caller's scope: no partial resources.
    await scope.dispose();
    assert.deepEqual(events, ["dispose-ok2", "dispose-ok1"]);
    assert.deepEqual(errors, []);
});

void test("a failure in the plugin's own logic disposes its dependencies", async () => {
    const events: string[] = [];
    const dep = definePlugin({
        name: "dep",
        apply: (_input: void, scope) => {
            scope.onDispose(() => {
                events.push("dispose-dep");
            });
            return { v: 1 };
        },
    });
    const root = definePlugin({
        name: "root",
        apply: (): { v: number } => {
            throw new Error("root boom");
        },
    });

    await assert.rejects(async () => {
        await root.use(dep).apply({}, createScope(), undefined);
    }, /root boom/);
    assert.deepEqual(events, ["dispose-dep"]);
});

void test("a dependency's invalid option aborts the application before its logic runs", async () => {
    let ran = false;
    const guarded = definePlugin({
        name: "guarded",
        Config: stringSchema,
        apply: () => {
            ran = true;
            return { v: "unreachable" };
        },
    });
    const root = definePlugin({ name: "root", apply: () => ({ r: 1 }) });

    const composed = root.use(guarded, { option: 42 as unknown as string });
    await assert.rejects(async () => {
        await composed.apply({}, createScope(), undefined);
    }, ConfigValidationError);
    assert.equal(ran, false);
});

void test("the root's config is validated before its own logic runs", async () => {
    const seen: unknown[] = [];
    const root = definePlugin({
        name: "root",
        Config: stringSchema,
        apply: (_input: void, _scope, config) => {
            seen.push(config);
            return { r: 1 };
        },
    });
    const dep = definePlugin({ name: "dep", apply: () => ({ v: 1 }) });

    const composed = root.use(dep);
    await assert.rejects(async () => {
        await composed.apply({}, createScope(), 42 as unknown as string);
    }, ConfigValidationError);
    assert.deepEqual(seen, []);

    assert.deepEqual(await composed.apply({}, createScope(), "ok"), { r: 1 });
    assert.deepEqual(seen, ["ok"]);
});

void test("successful applications register teardown onto the caller's scope, own logic first (LIFO)", async () => {
    const events: string[] = [];
    const make = <const TName extends string>(name: TName) =>
        definePlugin({
            name,
            apply: (_input: void, scope) => {
                scope.onDispose(() => {
                    events.push(`dispose-${name}`);
                });
                return { name };
            },
        });
    const root = definePlugin({
        name: "root",
        apply: (_input: void, scope) => {
            scope.onDispose(() => {
                events.push("dispose-root");
            });
            return { r: 1 };
        },
    });

    const composed = root.use(make("p1")).use(make("p2"));
    const scope = createScope();
    assert.deepEqual(await composed.apply({}, scope, undefined), { r: 1 });

    // The root's logic ran last, so its teardown registered last and runs
    // first: the scope unwinds the dependency tree in reverse dependency
    // order.
    await scope.dispose();
    assert.deepEqual(events, ["dispose-root", "dispose-p2", "dispose-p1"]);
});

void test("error reports and disposer failures fall through to the scope's error channel", async () => {
    const errors: unknown[] = [];
    const reporter = definePlugin({
        name: "reporter",
        apply: (_input: void, scope) => {
            scope.onError(new Error("background"));
            scope.onDispose(() => {
                throw new Error("teardown failed");
            });
            return { r: 1 };
        },
    });
    const host = definePlugin({ name: "host", apply: () => ({ h: 1 }) });

    const scope = createScope({ onError: (error) => errors.push(error) });
    await host.use(reporter).apply({}, scope, undefined);
    assert.deepEqual(
        errors.map((error) => (error as Error).message),
        ["background"],
    );

    await scope.dispose();
    assert.deepEqual(
        errors.map((error) => (error as Error).message),
        ["background", "teardown failed"],
    );
});

void test("createScope disposes in LIFO order, routes failures to onError, and is idempotent", async () => {
    const events: string[] = [];
    const errors: unknown[] = [];
    const scope = createScope({ onError: (error) => errors.push(error) });
    scope.onDispose(() => {
        events.push("first");
    });
    scope.onDispose(() => {
        throw new Error("teardown failed");
    });
    scope.onDispose(() => {
        events.push("last");
    });

    await scope.dispose();
    await scope.dispose();
    assert.deepEqual(events, ["last", "first"]);
    assert.equal(errors.length, 1);
});

/* Compile-time only: P6 — the wiring rules the runtime enforces
   dynamically are enforced statically for code the type system can see. */
void test("wiring rules are enforced statically", () => {
    const host = definePlugin({ name: "host", apply: () => ({}) });
    const dup = definePlugin({ name: "dup", apply: () => ({ v: 1 }) });
    const other = definePlugin({ name: "other", apply: () => ({ v: 2 }) });
    const composed = host.use(dup);
    // @ts-expect-error a namespace may be introduced at most once
    void composed.use(other, { as: "dup" });

    const needy = definePlugin({
        name: "needy",
        apply: (ctx: { missing: string }) => ({ v: ctx.missing }),
    });
    // @ts-expect-error a mapping is required when identity wiring cannot satisfy the declared input
    void host.use(needy);
    // @ts-expect-error a hermetic dependency cannot declare a required input
    void host.with(needy);

    const guarded = definePlugin({
        name: "guarded",
        Config: stringSchema,
        apply: (_input: void, _scope, config) => ({ v: config }),
    });
    // @ts-expect-error option is required when the dependency declares a config schema
    void host.use(guarded);
    void host.with(guarded, { option: "fine" });

    const reader = definePlugin({
        name: "reader",
        apply: (ctx: { dep: { expected: string } }) => ({ v: ctx.dep.expected }),
    });
    const mismatched = definePlugin({ name: "dep", apply: () => ({ wrong: 1 }) });
    // @ts-expect-error the dependency's item map does not satisfy the declared input at its namespace
    void reader.use(mismatched);
});
