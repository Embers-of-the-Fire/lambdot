import assert from "node:assert/strict";
import test from "node:test";

import { createScope } from "@lambdot/core";
import { Hono } from "hono";

import { httpHono } from "./index.ts";

void test("the emitted item map is the host's hono app, typed as HttpServer", async () => {
    const hono = new Hono();
    const scope = createScope();
    const http = await httpHono.apply(undefined, scope, { hono });

    // Routes registered through the contract run on the host's app.
    http.on("GET", "/health", () => new Response("ok"));
    http.on("GET", "/users/:id", (c) => Response.json({ id: c.req.param("id") }));

    const health = await hono.fetch(new Request("http://localhost/health"));
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const user = await hono.fetch(new Request("http://localhost/users/42"));
    assert.equal(user.status, 200);
    assert.deepEqual(await user.json(), { id: "42" });

    const missing = await hono.fetch(new Request("http://localhost/nope"));
    assert.equal(missing.status, 404);

    await scope.dispose();
});
