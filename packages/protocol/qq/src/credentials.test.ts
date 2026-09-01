import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_QQ_CREDENTIAL_KEYS, readQqCredentials } from "./credentials.ts";

void test("readQqCredentials reads the default keys", () => {
    const credentials = readQqCredentials({
        QQ_BOT_APP_ID: "app",
        QQ_BOT_APP_SECRET: "secret",
    });
    assert.deepEqual(credentials, { appId: "app", clientSecret: "secret" });
    assert.deepEqual(DEFAULT_QQ_CREDENTIAL_KEYS, {
        appId: "QQ_BOT_APP_ID",
        clientSecret: "QQ_BOT_APP_SECRET",
    });
});

void test("readQqCredentials honors custom keys and fails loudly when absent", () => {
    const keys = { appId: "MY_ID", clientSecret: "MY_SECRET" };
    assert.deepEqual(readQqCredentials({ MY_ID: "a", MY_SECRET: "s" }, keys), {
        appId: "a",
        clientSecret: "s",
    });
    assert.throws(() => readQqCredentials({}, keys), /credentials missing/);
    assert.throws(() => readQqCredentials({ MY_ID: "a" }, keys), /credentials missing/);
});
