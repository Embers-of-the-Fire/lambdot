/**
 * Compile-time assertions for the composition model: namespace visibility,
 * identity wiring vs. required mappings, and duplicate rejection. Run by
 * typecheck; every `@ts-expect-error` must stay a genuine error.
 */
import { consolePlatform, type ConsoleLine, type ConsoleReply } from "@lambdot/console";
import type { Stream } from "@lambdot/core";
import { createKernel, definePlugin, mapStream } from "@lambdot/core";

const echo = definePlugin({
    name: "echo",
    apply(input: { "console/lines": Stream<ConsoleLine> }) {
        return mapStream(input["console/lines"], (event) => ({
            address: event.address,
            content: `echo: ${event.payload}`,
        }));
    },
});

const cli = consolePlatform();

const kernel = createKernel()
    .use(cli.lines)
    .use(echo)
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.echo }) });

// the exposed namespaces are typed on the composition's ctx
const lines: Stream<ConsoleLine> = kernel.ctx["console/lines"];
const replies: Stream<ConsoleReply> = kernel.ctx.echo;
void lines;
void replies;

// bound namespaces are hidden from the final ctx
// @ts-expect-error the printer was bound, not used
void kernel.ctx["console/printer"];

// identity wiring only works when the declared input is already visible;
// otherwise the mapping becomes a required argument
// @ts-expect-error echo needs "console/lines"; the empty kernel does not have it
void createKernel().use(echo);

// @ts-expect-error no "replies" namespace exists to identity-wire the printer
void createKernel().use(cli.lines).use(cli.printer);

// mappings are checked against the visible ctx: missing namespaces error
void createKernel()
    .use(cli.lines)
    .use(cli.printer, {
        // @ts-expect-error "echo" is not composed yet
        mapping: (ctx) => ({ replies: ctx.echo }),
    });

// mappings must feed the declared input with compatible types
void createKernel()
    .use(cli.lines)
    .use(cli.printer, {
        // @ts-expect-error the printer wants Stream<ConsoleReply>, not the line stream
        mapping: (ctx) => ({ replies: ctx["console/lines"] }),
    });

// duplicate namespaces are rejected
void createKernel()
    .use(cli.lines)
    // @ts-expect-error "console/lines" is already taken
    .use(cli.lines);

/* ------------------------------------------------------------------ */
/* expose: sealing a chain into a named engine                        */
/* ------------------------------------------------------------------ */

// expose seals the chain into a final artifact: the visible ctx survives
// under the new name, the bound internals are erased from the type
const bot = createKernel()
    .use(cli.lines)
    .use(echo)
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.echo }) })
    .expose("bot");

const botName: "bot" = bot.name;
void botName;
const botCtx: { "console/lines": Stream<ConsoleLine>; echo: Stream<ConsoleReply> } = bot.ctx;
void botCtx;

// @ts-expect-error the printer was bound: erased by expose, absent from ctx
void bot.ctx["console/printer"];

// @ts-expect-error the engine is final: no composition methods
bot.use(echo);

// an engine is a unit: a supervisor kernel wires it under its exposed name
const supervisor = createKernel().use(bot);
const nested: { "console/lines": Stream<ConsoleLine>; echo: Stream<ConsoleReply> } =
    supervisor.ctx.bot;
void nested;

// the engine's external input requirement survives exposure: a chain built
// on echo still needs "console/lines", so identity wiring fails on an empty
// kernel and succeeds once the dependency is visible
const halfBot = echo
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.echo }) })
    .expose("half");

// @ts-expect-error the exposed engine still declares "console/lines" as input
void createKernel().use(halfBot);
void createKernel().use(cli.lines).use(halfBot);
