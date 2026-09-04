import assert from "node:assert/strict";
import test from "node:test";

import { createScope } from "@lambdot/core";

import { sqliteDatabase } from "./index.ts";

void test("sqliteDatabase opens an in-memory database and closes it with the scope", async () => {
    const scope = createScope();
    const db = await sqliteDatabase("db").apply(undefined, scope, { path: ":memory:" });
    db.exec("CREATE TABLE visits (n INTEGER)");
    db.exec("INSERT INTO visits VALUES (1)");
    const row = db.prepare("SELECT n FROM visits").get() as { n: number };
    assert.equal(row.n, 1);

    await scope.dispose();
    assert.throws(() => db.exec("SELECT 1"), /not open|closed/i);
});
