import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTwin } from "../site/twin-core.mjs";

async function browserJson(relative) {
  assert.match(relative, /^\.\//);
  return JSON.parse(
    await readFile(new URL(`../site/${relative.slice(2)}`, import.meta.url), "utf8"),
  );
}

test("README static browser fixture example executes from the site root", async () => {
  const accounts = await browserJson("./api/data/v9.2/accounts.json");
  assert.equal(accounts["@odata.count"], 12);
  assert.equal(typeof accounts.value[0].name, "string");
});

test("README injected browser example executes with site-root relative paths", async () => {
  const seed = await browserJson("./data/seed.json");
  const twin = createTwin({
    seed,
    retry: { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 5_000 },
  });
  const created = await twin.fetch("/api/data/v9.2/accounts", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "x-logical-request-id": "create-account-001",
    },
    body: { name: "Prairie Lantern Supply" },
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).name, "Prairie Lantern Supply");
});

test("README Node example executes from repository-source files without relative fetch", async () => {
  const seed = JSON.parse(
    await readFile(new URL("../data/seed.json", import.meta.url), "utf8"),
  );
  const twin = createTwin({ seed });
  const response = await twin.fetch("/api/data/v9.2/accounts?$top=1");
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.value.length, 1);
});
