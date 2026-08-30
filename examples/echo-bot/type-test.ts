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
