/**
 * Compile-time assertions for the composition model: namespace visibility,
 * identity wiring vs. required mappings, hermetic `with` constraints, and
 * duplicate rejection. Run by typecheck; every `@ts-expect-error` must stay
 * a genuine error.
 */
import { consoleIo, type ConsoleIo } from "@lambdot/console";
import type { OutOf } from "@lambdot/core";
import { createScope, definePlugin } from "@lambdot/core";

const echo = definePlugin({
    name: "echo",
    apply(input: { console: ConsoleIo }, scope) {
        scope.onDispose(input.console.onLine((line) => input.console.print(`echo: ${line}`)));
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(consoleIo(), { option: {} })
    .use(echo);

// the composition is itself a plugin; apply returns the root's own item map
const items: {} = await app.apply({}, createScope(), undefined);
void items;

// identity wiring only works when the declared input is already visible;
// otherwise the mapping becomes a required argument
// @ts-expect-error echo needs "console"; the bare root does not have it
void definePlugin({ name: "bare", apply: () => ({}) }).use(echo);

// ...and the mapping is checked against the namespaces visible at that
// point in the chain
void definePlugin({ name: "bare", apply: () => ({}) }).use(echo, {
    // @ts-expect-error "console" is not composed yet
    mapping: (ctx) => ({ console: ctx.console }),
});

// mappings must feed the declared input with compatible types
void definePlugin({ name: "bare", apply: () => ({}) })
    .with(consoleIo(), { option: {} })
    .use(echo, {
        // @ts-expect-error echo wants ConsoleIo, not a function
        mapping: (ctx) => ({ console: (text: string) => ctx.console.print(text) }),
    });

// a hermetic dependency is granted a blank context, so it cannot declare
// required input
// @ts-expect-error echo requires "console"; with grants a blank context
void definePlugin({ name: "bare", apply: () => ({}) }).with(echo);

// `with` has no mapping: the granted context is always blank, so there is
// nothing to adapt
void definePlugin({ name: "bare", apply: () => ({}) }).with(consoleIo(), {
    option: {},
    // @ts-expect-error with accepts only `as` and `option`
    mapping: (ctx: unknown) => ctx,
});

// the option is required exactly when the config type is non-void
// @ts-expect-error consoleIo's config is non-void (pass `{}` for defaults)
void definePlugin({ name: "bare", apply: () => ({}) }).with(consoleIo());

// duplicate namespaces are rejected
const taken = definePlugin({ name: "taken", apply: () => ({}) }).with(consoleIo(), { option: {} });
// @ts-expect-error "console" is already taken
void taken.with(consoleIo(), { option: {} });

// `as` renames the namespace; the declared input must then be mapped from
// the renamed key
const renamed = definePlugin({ name: "renamed", apply: () => ({}) })
    .with(consoleIo(), { option: {}, as: "tty" })
    .use(echo, { mapping: (ctx) => ({ console: ctx.tty }) });
void renamed;

/* ------------------------------------------------------------------ */
/* nesting: a composed plugin is a plugin                              */
/* ------------------------------------------------------------------ */

// composing two plugins yields a plugin; used as a dependency, its whole
// item map nests under one namespace of the parent's context
const bot = definePlugin({ name: "bot", apply: (ctx: { console: ConsoleIo }) => ctx.console })
    .with(consoleIo(), { option: {} })
    .use(echo);

const outer = definePlugin({
    name: "outer",
    apply: (ctx: { bot: ConsoleIo }) => ({ greeting: (text: string) => ctx.bot.print(text) }),
}).use(bot);
void outer;

const nested: ConsoleIo = {} as OutOf<typeof bot>;
void nested;
// @ts-expect-error the nested plugin's item map is ConsoleIo, not a number
const wrong: number = {} as OutOf<typeof bot>;
void wrong;
