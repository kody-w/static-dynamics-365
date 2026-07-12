import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  TwinReplayDivergenceError,
  TwinRetryExhaustedError,
  VirtualClock,
  canonicalStringify,
  createTwin,
  deterministicGuid,
  normalizeUtc,
  parsePath,
  replayRun,
  sha256,
} from "../site/twin-core.mjs";

const seed = JSON.parse(
  fs.readFileSync(new URL("../data/seed.json", import.meta.url), "utf8"),
);

function twin(options = {}) {
  return createTwin({ seed, ...options });
}

async function json(response) {
  return response.json();
}

test("canonical digests and deterministic IDs have stable vectors", () => {
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(canonicalStringify({ z: 1, a: [true, null] }), '{"a":[true,null],"z":1}');
  assert.equal(
    deterministicGuid("vector"),
    "b0d51c58-c8b9-51f4-98fa-df16c7d37563",
  );
});

test("same seed and request sequence produce identical state and trace", async () => {
  const first = twin();
  const second = twin();
  for (const instance of [first, second]) {
    const account = instance.state().entities.accounts[0];
    await instance.fetch(`/api/data/v9.2/accounts(${account.accountid})`, {
      method: "PATCH",
      headers: {
        "if-match": account["@odata.etag"],
        "x-logical-request-id": "same-update",
      },
      body: { description: "Deterministic update." },
    });
    instance.advanceTime(1250);
    await instance.fetch("/api/data/v9.2/incidents?$orderby=ticketnumber desc&$top=4");
  }
  assert.equal(first.stateDigest(), second.stateDigest());
  assert.equal(first.traceDigest(), second.traceDigest());
  assert.deepEqual(first.trace, second.trace);
});

test("GET supports collections, records, select, filter, order, paging, and count", async () => {
  const instance = twin();
  const response = await instance.fetch(
    "/api/data/v9.2/incidents?$select=incidentid,title,prioritycode&$filter=statecode%20eq%200%20and%20contains(title,%27order%27)&$orderby=title%20asc&$skip=0&$top=5&$count=true",
  );
  assert.equal(response.status, 200);
  const payload = await json(response);
  assert.equal(payload["@odata.count"], 2);
  assert.equal(payload.value.length, 2);
  assert.deepEqual(
    Object.keys(payload.value[0]).sort(),
    ["@odata.etag", "incidentid", "prioritycode", "title"].sort(),
  );
  const recordResponse = await instance.fetch(
    `/api/data/v9.2/incidents(${payload.value[0].incidentid})?$select=title`,
  );
  assert.equal(recordResponse.status, 200);
  assert.equal(typeof (await json(recordResponse)).title, "string");
});

test("unsupported and malformed query syntax is rejected", async () => {
  const instance = twin();
  for (const path of [
    "/api/data/v9.2/accounts?$expand=contacts",
    "/api/data/v9.2/accounts?$filter=name%20matches%20%27x%27",
    "/api/data/v9.2/accounts?$orderby=missing",
    "/api/data/v9.2/accounts?$top=-1",
    "/api/data/v9.2/accounts?$count=yes",
    "/api/data/v9.2/accounts?$select=missing",
  ]) {
    const response = await instance.fetch(path);
    assert.equal(response.status, 400, path);
  }
});

test("WhoAmI and metadata derive from the simulation identity and state", async () => {
  const instance = twin();
  const whoami = await json(await instance.fetch("/api/data/v9.2/WhoAmI"));
  const staticWhoAmI = JSON.parse(
    fs.readFileSync(new URL("../site/api/data/v9.2/WhoAmI.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(whoami, staticWhoAmI);
  assert.deepEqual(whoami, seed.identity);
  const metadata = await json(await instance.fetch("/api/data/v9.2/$metadata"));
  const staticMetadata = JSON.parse(
    fs.readFileSync(new URL("../site/api/data/v9.2/$metadata.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(metadata, staticMetadata);
  assert.deepEqual(metadata, seed.metadata);
});

test("runtime metadata counts follow create, delete, and reset", async () => {
  const instance = twin();
  const count = async (entity) => {
    const metadata = await json(await instance.fetch("/api/data/v9.2/$metadata"));
    return metadata.entitySets.find((item) => item.name === entity).count;
  };
  const baseline = seed.entities.accounts.length;
  assert.equal(await count("accounts"), baseline);

  let response = await instance.fetch("/api/data/v9.2/accounts", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: { name: "Metadata Count Account" },
  });
  const created = await json(response);
  assert.equal(await count("accounts"), baseline + 1);

  response = await instance.fetch(
    `/api/data/v9.2/accounts(${created.accountid})`,
    {
      method: "DELETE",
      headers: { "if-match": created["@odata.etag"] },
    },
  );
  assert.equal(response.status, 204);
  assert.equal(await count("accounts"), baseline);

  await instance.fetch("/api/data/v9.2/accounts", {
    method: "POST",
    body: { name: "Reset Metadata Count Account" },
  });
  assert.equal(await count("accounts"), baseline + 1);
  instance.reset();
  assert.equal(await count("accounts"), baseline);
});

test("happy CRUD is idempotent and Prefer returns representations", async () => {
  const instance = twin();
  const headers = {
    prefer: "return=representation",
    "x-logical-request-id": "account-create-1",
  };
  const create = await instance.fetch("/api/data/v9.2/accounts", {
    method: "POST",
    headers,
    body: { name: "Prairie Lantern Supply" },
  });
  assert.equal(create.status, 201);
  const created = await json(create);
  assert.equal(created.name, "Prairie Lantern Supply");
  const repeated = await instance.fetch("/api/data/v9.2/accounts", {
    method: "POST",
    headers,
    body: { name: "Prairie Lantern Supply" },
  });
  assert.equal(repeated.status, 201);
  assert.equal((await json(repeated)).accountid, created.accountid);
  assert.equal(
    instance.trace.filter(
      (event) =>
        event.kind === "commit" &&
        event.logicalRequestId === "account-create-1",
    ).length,
    1,
  );
  const update = await instance.fetch(
    `/api/data/v9.2/accounts(${created.accountid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": created["@odata.etag"],
        prefer: "return=representation",
      },
      body: { telephone1: "+1-202-555-0199" },
    },
  );
  assert.equal(update.status, 200);
  const updated = await json(update);
  assert.equal(updated.telephone1, "+1-202-555-0199");
  const deleted = await instance.fetch(
    `/api/data/v9.2/accounts(${created.accountid})`,
    {
      method: "DELETE",
      headers: { "if-match": updated["@odata.etag"] },
    },
  );
  assert.equal(deleted.status, 204);
});

test("logical request IDs reject a different second mutation", async () => {
  const instance = twin();
  const account = instance.state().entities.accounts[0];
  const common = {
    method: "PATCH",
    headers: {
      "if-match": account["@odata.etag"],
      "x-logical-request-id": "fixed-id",
    },
  };
  assert.equal(
    (
      await instance.fetch(`/api/data/v9.2/accounts(${account.accountid})`, {
        ...common,
        body: { description: "First" },
      })
    ).status,
    204,
  );
  const conflict = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    { ...common, body: { description: "Different" } },
  );
  assert.equal(conflict.status, 409);
});

test("caller logical MAX_SAFE_INTEGER never advances or overflows automatic IDs", async () => {
  const instance = twin();
  const create = (name, logicalId = null) =>
    instance.fetch("/api/data/v9.2/accounts", {
      method: "POST",
      headers: logicalId ? { "x-logical-request-id": logicalId } : {},
      body: { name },
    });
  const maximum = `logical-${Number.MAX_SAFE_INTEGER}`;
  assert.equal((await create("Explicit maximum", maximum)).status, 204);
  for (const name of ["Implicit one", "Implicit two", "Implicit three"]) {
    assert.equal((await create(name)).status, 204);
  }
  assert.equal((await create("Explicit collision", "logical-000004")).status, 204);
  assert.equal((await create("Implicit after collision")).status, 204);
  const logicalIds = instance.exportRun().requests.map(
    (request) => request.init.headers["x-logical-request-id"],
  );
  assert.deepEqual(logicalIds, [
    maximum,
    "logical-000001",
    "logical-000002",
    "logical-000003",
    "logical-000004",
    "logical-000005",
  ]);
  assert.equal(new Set(logicalIds).size, logicalIds.length);
});

test("invalid JSON, unknown fields, invalid types, and state pairs do not mutate state", async () => {
  const instance = twin();
  const before = instance.stateDigest();
  const account = instance.state().entities.accounts[0];
  const attempts = [
    "{bad",
    JSON.stringify({ unsupported_field: true }),
    JSON.stringify({ prioritycode: "high" }),
    JSON.stringify({ statecode: 1, statuscode: 1 }),
  ];
  const paths = [
    "/api/data/v9.2/accounts",
    "/api/data/v9.2/accounts",
    "/api/data/v9.2/incidents",
    `/api/data/v9.2/accounts(${account.accountid})`,
  ];
  for (let index = 0; index < attempts.length; index += 1) {
    const response = await instance.fetch(paths[index], {
      method: index === 3 ? "PATCH" : "POST",
      body: attempts[index],
    });
    assert.equal(response.status, 400);
  }
  assert.equal(instance.stateDigest(), before);
});

test("two stale writers produce one update and one precondition failure", async () => {
  const instance = twin();
  const account = instance.state().entities.accounts[0];
  const first = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: { "if-match": account["@odata.etag"] },
      body: { description: "Writer one" },
    },
  );
  const second = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: { "if-match": account["@odata.etag"] },
      body: { description: "Writer two" },
    },
  );
  assert.equal(first.status, 204);
  assert.equal(second.status, 412);
});

test("runtime ETags are ABA-safe", async () => {
  const instance = twin();
  const account = instance.state().entities.accounts[0];
  const original = account["@odata.etag"];
  let response = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: { "if-match": original, prefer: "return=representation" },
      body: { description: "Intermediate" },
    },
  );
  const middle = await json(response);
  response = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: { "if-match": middle["@odata.etag"], prefer: "return=representation" },
      body: { description: account.description },
    },
  );
  const reverted = await json(response);
  assert.notEqual(reverted["@odata.etag"], original);
  const stale = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: { "if-match": original },
      body: { description: "Stale" },
    },
  );
  assert.equal(stale.status, 412);
});

test("PATCH validates required fields after merge", async () => {
  const instance = twin();
  const account = instance.state().entities.accounts[0];
  const valid = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: { "if-match": account["@odata.etag"], prefer: "return=representation" },
      body: { description: "Only an optional field changed." },
    },
  );
  assert.equal(valid.status, 200);
  const current = await json(valid);
  const invalid = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: { "if-match": current["@odata.etag"] },
      body: { name: "" },
    },
  );
  assert.equal(invalid.status, 400);
  assert.equal(
    instance.state().entities.accounts.find(
      (record) => record.accountid === account.accountid,
    ).name,
    account.name,
  );
});

test("malformed paths and explicit-offset datetime rules are deterministic", async () => {
  const instance = twin();
  const response = await instance.fetch("/api/data/v9.2/accounts(%ZZ)");
  assert.equal(response.status, 400);
  assert.throws(() => normalizeUtc("2026-01-15T12:00:00"), /explicit UTC offset/);
  assert.equal(
    normalizeUtc("2026-01-15T07:00:00-05:00"),
    "2026-01-15T12:00:00.000Z",
  );
  assert.deepEqual(parsePath("/api/data/v9.2/accounts").kind, "collection");
});

test("429 and 503 retry at exact virtual times", async () => {
  for (const type of ["http-429", "http-503"]) {
    const instance = twin({
      faults: [{ type, times: 2, retryAfterMs: 250 }],
      retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
    });
    const before = Number(instance.clock);
    const response = await instance.fetch("/api/data/v9.2/accounts?$top=1");
    assert.equal(response.status, 200);
    assert.equal(Number(instance.clock) - before, 500);
    assert.deepEqual(
      instance.trace.filter((event) => event.kind === "retry").map((event) => event.delay),
      [250, 250],
    );
  }
});

test("retry exhaustion is explicit", async () => {
  const instance = twin({
    faults: [{ type: "http-503", times: 3 }],
    retry: { maxAttempts: 2, baseDelayMs: 10 },
  });
  await assert.rejects(
    instance.request("/api/data/v9.2/accounts"),
    (error) => error instanceof TwinRetryExhaustedError && error.attempts === 2,
  );
});

test("post-commit response loss retries once without double apply", async () => {
  const instance = twin({
    faults: [{ type: "post-commit-loss", method: "PATCH" }],
    retry: { maxAttempts: 2, baseDelayMs: 25 },
  });
  const account = instance.state().entities.accounts[0];
  const response = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: { "if-match": account["@odata.etag"] },
      body: { description: "Committed once" },
    },
  );
  assert.equal(response.status, 204);
  assert.equal(
    instance.trace.filter(
      (event) => event.kind === "commit" && event.id === account.accountid,
    ).length,
    1,
  );
  assert.equal(
    instance.trace.filter((event) => event.kind === "idempotent-replay").length,
    1,
  );
});

test("transport faults execute before idempotent server replay", async () => {
  const instance = twin();
  const account = instance.state().entities.accounts[0];
  const init = {
    method: "PATCH",
    headers: {
      "if-match": account["@odata.etag"],
      "x-logical-request-id": "server-replay",
    },
    body: { description: "Cached mutation" },
  };
  assert.equal(
    (await instance.fetch(`/api/data/v9.2/accounts(${account.accountid})`, init)).status,
    204,
  );
  instance.setFaultPlan([{ type: "network", method: "PATCH" }]);
  const before = Number(instance.clock);
  const replayed = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    { ...init, retry: { maxAttempts: 2, baseDelayMs: 10 } },
  );
  assert.equal(replayed.status, 204);
  assert.equal(Number(instance.clock) - before, 10);
});

test("network, timeout, malformed-response, and delay faults are isolated", async () => {
  for (const type of ["network", "timeout"]) {
    const instance = twin({ faults: [{ type, delayMs: 30 }] });
    const before = canonicalStringify(instance.state().entities);
    await assert.rejects(
      instance.fetch("/api/data/v9.2/accounts"),
      TwinRetryExhaustedError,
    );
    assert.equal(canonicalStringify(instance.state().entities), before);
  }
  const malformed = twin({ faults: [{ type: "malformed" }] });
  const malformedBefore = malformed.stateDigest();
  const malformedResponse = await malformed.fetch("/api/data/v9.2/accounts");
  await assert.rejects(malformedResponse.json());
  assert.equal(malformed.stateDigest(), malformedBefore);

  const delayed = twin({ faults: [{ type: "delay", delayMs: 175 }] });
  const clockBefore = Number(delayed.clock);
  assert.equal((await delayed.fetch("/api/data/v9.2/accounts?$top=1")).status, 200);
  assert.equal(Number(delayed.clock) - clockBefore, 175);
});

test("time advancement leaves open tasks open while making them overdue", () => {
  const instance = twin();
  const openBefore = instance.state().entities.tasks.filter((record) => record.statecode === 0).length;
  instance.advanceTime(90 * 86400000);
  const tasks = instance.state().entities.tasks;
  assert.equal(tasks.filter((record) => record.statecode === 0).length, openBefore);
  assert.ok(
    tasks
      .filter((record) => record.statecode === 0)
      .every((record) => Date.parse(record.scheduledend) < Number(instance.clock)),
  );
});

test("task and case lifecycle transitions are explicit PATCH operations", async () => {
  const instance = twin();
  const task = instance.state().entities.tasks.find((record) => record.statecode === 0);
  let response = await instance.fetch(`/api/data/v9.2/tasks(${task.activityid})`, {
    method: "PATCH",
    headers: { "if-match": task["@odata.etag"], prefer: "return=representation" },
    body: {
      statecode: 1,
      statuscode: 5,
      percentcomplete: 100,
      actualend: instance.clock.now(),
    },
  });
  assert.equal((await json(response)).statecode, 1);
  const incident = instance.state().entities.incidents.find((record) => record.statecode === 0);
  response = await instance.fetch(`/api/data/v9.2/incidents(${incident.incidentid})`, {
    method: "PATCH",
    headers: { "if-match": incident["@odata.etag"], prefer: "return=representation" },
    body: { statecode: 1, statuscode: 5 },
  });
  const resolved = await json(response);
  assert.equal(resolved.statecode, 1);
  assert.equal(resolved.resolvedon, instance.clock.now());
  response = await instance.fetch(`/api/data/v9.2/incidents(${incident.incidentid})`, {
    method: "PATCH",
    headers: { "if-match": resolved["@odata.etag"], prefer: "return=representation" },
    body: { statecode: 0, statuscode: 1 },
  });
  assert.equal((await json(response)).resolvedon, null);
});

test("case updates and lifecycle transitions refresh every formatted code annotation", async () => {
  const instance = twin();
  const [account] = instance.state().entities.accounts;
  const [contact] = instance.state().entities.contacts;
  const formatted = (record, field) =>
    record[`${field}@OData.Community.Display.V1.FormattedValue`];
  let response = await instance.fetch("/api/data/v9.2/incidents", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: {
      title: "Formatted annotation lifecycle",
      customerid: account.accountid,
      customeridtype: "accounts",
      primarycontactid: contact.contactid,
    },
  });
  assert.equal(response.status, 201);
  let incident = await json(response);
  assert.deepEqual(
    ["prioritycode", "caseorigincode", "casetypecode", "statecode", "statuscode"].map(
      (field) => formatted(incident, field),
    ),
    ["Normal", "Email", "Request", "Active", "In Progress"],
  );

  response = await instance.fetch(
    `/api/data/v9.2/incidents(${incident.incidentid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": incident["@odata.etag"],
        prefer: "return=representation",
      },
      body: {
        prioritycode: 1,
        caseorigincode: 1,
        casetypecode: 1,
        statecode: 0,
        statuscode: 4,
      },
    },
  );
  assert.equal(response.status, 200);
  incident = await json(response);
  assert.deepEqual(
    ["prioritycode", "caseorigincode", "casetypecode", "statecode", "statuscode"].map(
      (field) => formatted(incident, field),
    ),
    ["High", "Phone", "Question", "Active", "Researching"],
  );

  response = await instance.fetch(
    `/api/data/v9.2/incidents(${incident.incidentid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": incident["@odata.etag"],
        prefer: "return=representation",
      },
      body: {
        prioritycode: 3,
        caseorigincode: 3,
        casetypecode: 3,
        statecode: 1,
        statuscode: 1000,
      },
    },
  );
  incident = await json(response);
  assert.deepEqual(
    ["prioritycode", "caseorigincode", "casetypecode", "statecode", "statuscode"].map(
      (field) => formatted(incident, field),
    ),
    ["Low", "Web", "Request", "Resolved", "Information Provided"],
  );

  response = await instance.fetch(
    `/api/data/v9.2/incidents(${incident.incidentid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": incident["@odata.etag"],
        prefer: "return=representation",
      },
      body: { statecode: 0, statuscode: 1 },
    },
  );
  incident = await json(response);
  assert.equal(formatted(incident, "statecode"), "Active");
  assert.equal(formatted(incident, "statuscode"), "In Progress");
  assert.equal(formatted(incident, "caseorigincode"), "Web");
  assert.equal(formatted(incident, "casetypecode"), "Request");
  assert.equal(instance.validateIntegrity(), true);

  const stored = instance.entities.incidents.get(incident.incidentid);
  stored["caseorigincode@OData.Community.Display.V1.FormattedValue"] = "Phone";
  assert.throws(() => instance.validateIntegrity(), /stale denormalized lookup data/);
});

test("referential deletion guards preserve accounts, contacts, and cases", async () => {
  const instance = twin();
  const account = instance.state().entities.accounts[0];
  const contact = instance.state().entities.contacts[0];
  const incident = instance.state().entities.incidents[0];
  for (const [entity, id, etag] of [
    ["accounts", account.accountid, account["@odata.etag"]],
    ["contacts", contact.contactid, contact["@odata.etag"]],
    ["incidents", incident.incidentid, incident["@odata.etag"]],
  ]) {
    const response = await instance.fetch(`/api/data/v9.2/${entity}(${id})`, {
      method: "DELETE",
      headers: { "if-match": etag },
    });
    assert.equal(response.status, 409, entity);
  }
});

test("reset restores the seed and exported requests replay to the same state", async () => {
  const instance = twin();
  const baseline = instance.contentDigest();
  const account = instance.state().entities.accounts[0];
  await instance.fetch(`/api/data/v9.2/accounts(${account.accountid})`, {
    method: "PATCH",
    headers: { "if-match": account["@odata.etag"] },
    body: { description: "Replay me" },
  });
  const expected = instance.stateDigest();
  const exported = instance.exportRun();
  const replayed = await replayRun(exported);
  assert.equal(replayed.stateDigest(), expected);
  const traceLength = instance.trace.length;
  instance.reset();
  assert.equal(instance.contentDigest(), baseline);
  assert.ok(instance.trace.length > traceLength);
});

test("replay preserves dynamic fault plans, virtual time, reset, and trace", async () => {
  const instance = twin({ retry: { maxAttempts: 2, baseDelayMs: 40 } });
  instance.setFaultPlan([{ type: "http-503", retryAfterMs: 75 }]);
  assert.equal((await instance.fetch("/api/data/v9.2/accounts?$top=1")).status, 200);
  instance.advanceTime(500);
  instance.reset();
  const account = instance.state().entities.accounts[0];
  await instance.fetch(`/api/data/v9.2/accounts(${account.accountid})`, {
    method: "PATCH",
    headers: { "if-match": account["@odata.etag"] },
    body: { description: "After reset" },
  });
  const replayed = await replayRun(instance.exportRun());
  assert.equal(replayed.stateDigest(), instance.stateDigest());
  assert.equal(replayed.traceDigest(), instance.traceDigest());
  assert.deepEqual(replayed.trace, instance.trace);
});

test("case lifecycle accepts every explicit valid vector and rejects legacy mismatches", async () => {
  const valid = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 5],
    [1, 1000],
    [2, 6],
    [2, 2000],
  ];
  const instance = twin();
  let incident = instance.state().entities.incidents.find((record) => record.statecode === 0);
  for (const [statecode, statuscode] of valid) {
    const response = await instance.fetch(
      `/api/data/v9.2/incidents(${incident.incidentid})`,
      {
        method: "PATCH",
        headers: {
          "if-match": incident["@odata.etag"],
          prefer: "return=representation",
        },
        body: { statecode, statuscode },
      },
    );
    assert.equal(response.status, 200, `${statecode}:${statuscode}`);
    incident = await response.json();
    assert.deepEqual([incident.statecode, incident.statuscode], [statecode, statuscode]);
  }
  for (const [statecode, statuscode] of [[1, 2], [1, 3], [0, 5], [2, 5]]) {
    const before = instance.stateDigest();
    const response = await instance.fetch(
      `/api/data/v9.2/incidents(${incident.incidentid})`,
      {
        method: "PATCH",
        headers: { "if-match": incident["@odata.etag"] },
        body: { statecode, statuscode },
      },
    );
    assert.equal(response.status, 400, `${statecode}:${statuscode}`);
    assert.equal(instance.stateDigest(), before);
  }
});

test("typed queries use declared fields and reject mismatched literals and encoding", async () => {
  const instance = twin();
  const createdResponse = await instance.fetch("/api/data/v9.2/accounts", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: { name: "Sparse Account" },
  });
  const created = await createdResponse.json();
  const sparse = await json(
    await instance.fetch(
      `/api/data/v9.2/accounts(${created.accountid})?$select=accountid,websiteurl`,
    ),
  );
  assert.equal(sparse.websiteurl, null);

  const invalid = [
    "/api/data/v9.2/accounts?$filter=statecode%20gt%20%27one%27",
    "/api/data/v9.2/accounts?$filter=statecode%20eq%201.5",
    "/api/data/v9.2/accounts?$filter=accountid%20eq%20not-a-guid",
    "/api/data/v9.2/accounts?$filter=createdon%20gt%202026-02-30T00%3A00%3A00Z",
    "/api/data/v9.2/emails?$filter=directioncode%20eq%20TRUE",
    "/api/data/v9.2/accounts?$filter=unknown%20eq%20%27x%27",
    "/api/data/v9.2/accounts?$filter=tolower(name)%20eq%20%27x%27",
    "/api/data/v9.2/accounts?$select=name&$select=description",
    "/api/data/v9.2/accounts?$orderby=undeclared",
    "/api/data/v9.2/accounts?$expand=contacts",
    "/api/data/v9.2/accounts?%C3%28=x",
    "/api/data/v9.2/WhoAmI?$top=1",
  ];
  for (const path of invalid) {
    assert.equal((await instance.fetch(path)).status, 400, path);
  }
  const validDate = await instance.fetch(
    "/api/data/v9.2/accounts?$filter=createdon%20lt%202026-01-15T12%3A00%3A00Z&$orderby=websiteurl%20asc",
  );
  assert.equal(validDate.status, 200);
});

test("email discriminators are field-specific and seeded system users round-trip", async () => {
  const instance = twin();
  const email = instance
    .state()
    .entities.emails.find(
      (record) =>
        record.senderidtype === "systemusers" ||
        record.recipientidtype === "systemusers",
    );
  const response = await instance.fetch(
    `/api/data/v9.2/emails(${email.activityid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": email["@odata.etag"],
        prefer: "return=representation",
      },
      body: {
        senderid: email.senderid,
        senderidtype: email.senderidtype,
        recipientid: email.recipientid,
        recipientidtype: email.recipientidtype,
        regardingobjectid: email.regardingobjectid,
        regardingobjectidtype: email.regardingobjectidtype,
      },
    },
  );
  assert.equal(response.status, 200);
  const roundTripped = await response.json();
  assert.equal(roundTripped.senderidtype, email.senderidtype);
  assert.equal(roundTripped.recipientidtype, email.recipientidtype);
  const before = instance.stateDigest();
  const invalid = await instance.fetch(
    `/api/data/v9.2/emails(${email.activityid})`,
    {
      method: "PATCH",
      headers: { "if-match": roundTripped["@odata.etag"] },
      body: { senderidtype: "incidents" },
    },
  );
  assert.equal(invalid.status, 400);
  assert.equal(instance.stateDigest(), before);
});

test("email POST defaults are direction-aware and round-trip through GET and replay", async () => {
  const instance = twin();
  const regarding = instance.state().entities.incidents[0];
  const create = async (directioncode, subject) => {
    const response = await instance.fetch("/api/data/v9.2/emails", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: {
        subject,
        directioncode,
        fromaddress: directioncode
          ? "support@crm.asterlane.example"
          : "customer@direction.example",
        toaddress: directioncode
          ? "customer@direction.example"
          : "support@crm.asterlane.example",
        regardingobjectid: regarding.incidentid,
        regardingobjectidtype: "incidents",
      },
    });
    assert.equal(response.status, 201);
    return response.json();
  };

  const outgoing = await create(true, "Direction-aware outgoing");
  assert.deepEqual(
    [
      outgoing.statecode,
      outgoing.statuscode,
      outgoing.senderidtype,
      outgoing.recipientidtype,
    ],
    [1, 3, "systemusers", "contacts"],
  );
  const incoming = await create(false, "Direction-aware incoming");
  assert.deepEqual(
    [
      incoming.statecode,
      incoming.statuscode,
      incoming.senderidtype,
      incoming.recipientidtype,
    ],
    [1, 4, "contacts", "systemusers"],
  );
  assert.equal(outgoing.senderid, seed.identities[0].systemuserid);
  assert.equal(incoming.recipientid, seed.identities[0].systemuserid);
  assert.equal(outgoing.recipientid, incoming.senderid);

  for (const created of [outgoing, incoming]) {
    const fetched = await json(
      await instance.fetch(`/api/data/v9.2/emails(${created.activityid})`),
    );
    assert.deepEqual(fetched, created);
  }
  const replayed = await replayRun(instance.exportRun());
  for (const created of [outgoing, incoming]) {
    assert.deepEqual(
      replayed
        .state()
        .entities.emails.find((record) => record.activityid === created.activityid),
      instance
        .state()
        .entities.emails.find((record) => record.activityid === created.activityid),
    );
  }
  assert.equal(instance.validateIntegrity(), true);
});

test("email POST, PATCH, and integrity reject direction contradictions without writes", async () => {
  const instance = twin();
  const regarding = instance.state().entities.incidents[0];
  const contact = instance.state().entities.contacts[0];
  const common = {
    subject: "Contradictory email",
    fromaddress: "support@crm.asterlane.example",
    toaddress: "customer@direction.example",
    regardingobjectid: regarding.incidentid,
    regardingobjectidtype: "incidents",
  };
  let before = instance.stateDigest();
  let response = await instance.fetch("/api/data/v9.2/emails", {
    method: "POST",
    body: { ...common, directioncode: true, statecode: 1, statuscode: 4 },
  });
  assert.equal(response.status, 400);
  assert.equal(instance.stateDigest(), before);

  response = await instance.fetch("/api/data/v9.2/emails", {
    method: "POST",
    body: {
      ...common,
      directioncode: false,
      senderid: seed.identities[0].systemuserid,
      senderidtype: "systemusers",
      recipientid: contact.contactid,
      recipientidtype: "contacts",
    },
  });
  assert.equal(response.status, 400);
  assert.equal(instance.stateDigest(), before);

  const outgoing = instance.state().entities.emails.find((record) => record.directioncode);
  for (const body of [
    { directioncode: false },
    {
      senderid: contact.contactid,
      senderidtype: "contacts",
    },
  ]) {
    before = instance.stateDigest();
    response = await instance.fetch(
      `/api/data/v9.2/emails(${outgoing.activityid})`,
      {
        method: "PATCH",
        headers: { "if-match": outgoing["@odata.etag"] },
        body,
      },
    );
    assert.equal(response.status, 400);
    assert.equal(instance.stateDigest(), before);
  }

  const stored = instance.entities.emails.get(outgoing.activityid);
  stored.directioncode = false;
  assert.throws(() => instance.validateIntegrity(), /Received email requires/);
});

test("account and contact name changes transactionally propagate every display lookup", async () => {
  const instance = twin();
  let account = instance.state().entities.accounts[0];
  const directTaskResponse = await instance.fetch("/api/data/v9.2/tasks", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: {
      subject: "Account regarding task",
      scheduledend: instance.clock.now(),
      regardingobjectid: account.accountid,
      regardingobjectidtype: "accounts",
    },
  });
  const directTask = await directTaskResponse.json();
  const directEmailResponse = await instance.fetch("/api/data/v9.2/emails", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: {
      subject: "Account regarding email",
      directioncode: true,
      fromaddress: "support@crm.asterlane.example",
      toaddress: "account@example.example",
      regardingobjectid: account.accountid,
      regardingobjectidtype: "accounts",
    },
  });
  const directEmail = await directEmailResponse.json();
  let response = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": account["@odata.etag"],
        prefer: "return=representation",
      },
      body: { name: "Renamed Account" },
    },
  );
  assert.equal(response.status, 200);
  const afterAccount = instance.state().entities;
  for (const contact of afterAccount.contacts.filter(
    (record) => record.parentcustomerid === account.accountid,
  )) {
    assert.equal(contact.parentcustomeridname, "Renamed Account");
    assert.equal(
      contact["parentcustomerid@OData.Community.Display.V1.FormattedValue"],
      "Renamed Account",
    );
  }
  for (const incident of afterAccount.incidents.filter(
    (record) =>
      record.customeridtype === "accounts" && record.customerid === account.accountid,
  )) {
    assert.equal(incident.customeridname, "Renamed Account");
  }
  assert.equal(
    afterAccount.tasks.find((record) => record.activityid === directTask.activityid)
      .regardingobjectidname,
    "Renamed Account",
  );
  assert.equal(
    afterAccount.emails.find((record) => record.activityid === directEmail.activityid)
      .regardingobjectidname,
    "Renamed Account",
  );

  let contact = afterAccount.contacts.find(
    (record) =>
      afterAccount.accounts.some((item) => item.primarycontactid === record.contactid) &&
      afterAccount.connections.some(
        (item) => item.record1id === record.contactid || item.record2id === record.contactid,
      ) &&
      afterAccount.emails.some(
        (item) => item.senderid === record.contactid || item.recipientid === record.contactid,
      ),
  );
  response = await instance.fetch(
    `/api/data/v9.2/contacts(${contact.contactid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": contact["@odata.etag"],
        prefer: "return=representation",
      },
      body: { firstname: "Renamed", lastname: "Contact" },
    },
  );
  assert.equal(response.status, 200);
  contact = await response.json();
  assert.equal(contact.fullname, "Renamed Contact");
  const afterContact = instance.state().entities;
  for (const item of afterContact.accounts.filter(
    (record) => record.primarycontactid === contact.contactid,
  )) {
    assert.equal(item.primarycontactidname, "Renamed Contact");
  }
  for (const item of afterContact.incidents.filter(
    (record) =>
      record.primarycontactid === contact.contactid ||
      (record.customeridtype === "contacts" && record.customerid === contact.contactid),
  )) {
    if (item.primarycontactid === contact.contactid) {
      assert.equal(item.primarycontactidname, "Renamed Contact");
    }
    if (item.customerid === contact.contactid) {
      assert.equal(item.customeridname, "Renamed Contact");
    }
  }
  for (const item of afterContact.emails.filter(
    (record) => record.senderid === contact.contactid || record.recipientid === contact.contactid,
  )) {
    if (item.senderid === contact.contactid) assert.equal(item.fromname, "Renamed Contact");
    if (item.recipientid === contact.contactid) assert.equal(item.toname, "Renamed Contact");
  }
  for (const item of afterContact.connections.filter(
    (record) => record.record1id === contact.contactid || record.record2id === contact.contactid,
  )) {
    if (item.record1id === contact.contactid) assert.equal(item.record1idname, "Renamed Contact");
    if (item.record2id === contact.contactid) assert.equal(item.record2idname, "Renamed Contact");
  }
  assert.equal(instance.validateIntegrity(), true);
});

test("direct task and email references independently restrict account and contact deletion", async () => {
  const instance = twin();
  const create = async (entity, body) => {
    const response = await instance.fetch(`/api/data/v9.2/${entity}`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body,
    });
    assert.equal(response.status, 201, entity);
    return response.json();
  };
  const remove = async (entity, record) =>
    instance.fetch(
      `/api/data/v9.2/${entity}(${record[entity === "contacts" ? "contactid" : entity === "accounts" ? "accountid" : "activityid"]})`,
      { method: "DELETE", headers: { "if-match": record["@odata.etag"] } },
    );

  const account = await create("accounts", { name: "Guard Account" });
  let task = await create("tasks", {
    subject: "Direct account task",
    scheduledend: instance.clock.now(),
    regardingobjectid: account.accountid,
    regardingobjectidtype: "accounts",
  });
  assert.equal((await remove("accounts", account)).status, 409);
  assert.equal((await remove("tasks", task)).status, 204);
  let email = await create("emails", {
    subject: "Direct account email",
    directioncode: true,
    fromaddress: "support@crm.asterlane.example",
    toaddress: "guard@example.example",
    regardingobjectid: account.accountid,
    regardingobjectidtype: "accounts",
  });
  assert.equal((await remove("accounts", account)).status, 409);
  assert.equal((await remove("emails", email)).status, 204);

  const contact = await create("contacts", {
    firstname: "Guard",
    lastname: "Contact",
    parentcustomerid: account.accountid,
  });
  task = await create("tasks", {
    subject: "Direct contact task",
    scheduledend: instance.clock.now(),
    regardingobjectid: contact.contactid,
    regardingobjectidtype: "contacts",
  });
  assert.equal((await remove("contacts", contact)).status, 409);
  assert.equal((await remove("tasks", task)).status, 204);
  email = await create("emails", {
    subject: "Contact party email",
    directioncode: true,
    fromaddress: "support@crm.asterlane.example",
    toaddress: "guard@example.example",
    recipientid: contact.contactid,
    recipientidtype: "contacts",
    regardingobjectid: instance.state().entities.incidents[0].incidentid,
    regardingobjectidtype: "incidents",
  });
  assert.equal((await remove("contacts", contact)).status, 409);
  assert.equal((await remove("emails", email)).status, 204);
  assert.equal((await remove("contacts", contact)).status, 204);
  const currentAccount = instance
    .state()
    .entities.accounts.find((record) => record.accountid === account.accountid);
  assert.equal((await remove("accounts", currentAccount)).status, 204);
  assert.equal(instance.validateIntegrity(), true);
});

test("an email directly regarding a contact prevents a dangling lookup on delete", async () => {
  const instance = twin();
  const create = async (entity, body) => {
    const response = await instance.fetch(`/api/data/v9.2/${entity}`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body,
    });
    assert.equal(response.status, 201, entity);
    return response.json();
  };
  const account = await create("accounts", { name: "Regarding Guard Parent" });
  const contact = await create("contacts", {
    firstname: "Regarding",
    lastname: "Guard",
    parentcustomerid: account.accountid,
  });
  const email = await create("emails", {
    subject: "Directly regarding contact",
    directioncode: true,
    fromaddress: "support@crm.asterlane.example",
    toaddress: "regarding.guard@example.example",
    regardingobjectid: contact.contactid,
    regardingobjectidtype: "contacts",
  });
  assert.notEqual(email.senderid, contact.contactid);
  assert.notEqual(email.recipientid, contact.contactid);
  const before = instance.stateDigest();
  const response = await instance.fetch(
    `/api/data/v9.2/contacts(${contact.contactid})`,
    {
      method: "DELETE",
      headers: { "if-match": contact["@odata.etag"] },
    },
  );
  assert.equal(response.status, 409);
  assert.equal(instance.stateDigest(), before);
  const after = instance.state().entities;
  assert.ok(after.contacts.some((item) => item.contactid === contact.contactid));
  assert.equal(
    after.emails.find((item) => item.activityid === email.activityid).regardingobjectid,
    contact.contactid,
  );
  assert.equal(instance.validateIntegrity(), true);
});

test("atomic deleteMany leaves mixed deletable and blocked account/contact selections untouched", async () => {
  const instance = twin();
  const create = async (entity, body) => {
    const response = await instance.fetch(`/api/data/v9.2/${entity}`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body,
    });
    assert.equal(response.status, 201, entity);
    return response.json();
  };

  const freeAccount = await create("accounts", { name: "Free Bulk Account" });
  const blockedAccount = await create("accounts", { name: "Blocked Bulk Account" });
  await create("tasks", {
    subject: "Block account bulk delete",
    scheduledend: instance.clock.now(),
    regardingobjectid: blockedAccount.accountid,
    regardingobjectidtype: "accounts",
  });
  let before = instance.stateDigest();
  let response = await instance.deleteMany("accounts", [
    { id: freeAccount.accountid, etag: freeAccount["@odata.etag"] },
    { id: blockedAccount.accountid, etag: blockedAccount["@odata.etag"] },
  ]);
  assert.equal(response.status, 409);
  assert.equal(instance.stateDigest(), before);
  assert.ok(
    [freeAccount, blockedAccount].every((selected) =>
      instance
        .state()
        .entities.accounts.some((record) => record.accountid === selected.accountid),
    ),
  );

  const freeContact = await create("contacts", {
    firstname: "Free",
    lastname: "Bulk Contact",
    parentcustomerid: freeAccount.accountid,
  });
  const blockedContact = await create("contacts", {
    firstname: "Blocked",
    lastname: "Bulk Contact",
    parentcustomerid: freeAccount.accountid,
  });
  await create("emails", {
    subject: "Block contact bulk delete",
    directioncode: true,
    fromaddress: "support@crm.asterlane.example",
    toaddress: "blocked.bulk@example.example",
    regardingobjectid: blockedContact.contactid,
    regardingobjectidtype: "contacts",
  });
  before = instance.stateDigest();
  response = await instance.deleteMany("contacts", [
    { id: freeContact.contactid, etag: freeContact["@odata.etag"] },
    { id: blockedContact.contactid, etag: blockedContact["@odata.etag"] },
  ]);
  assert.equal(response.status, 409);
  assert.equal(instance.stateDigest(), before);
  assert.ok(
    [freeContact, blockedContact].every((selected) =>
      instance
        .state()
        .entities.contacts.some((record) => record.contactid === selected.contactid),
    ),
  );
  assert.equal(instance.validateIntegrity(), true);
});

test("connection create, update, and delete preserve an atomic deterministic reciprocal pair", async () => {
  const instance = twin();
  const [left, right] = instance.state().entities.contacts;
  let response = await instance.fetch("/api/data/v9.2/connections", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: {
      record1id: left.contactid,
      record1type: "contacts",
      record2id: right.contactid,
      record2type: "contacts",
      record1roleidname: "Mentor",
      record2roleidname: "Associate",
    },
  });
  assert.equal(response.status, 201);
  let connection = await response.json();
  let pair = instance
    .state()
    .entities.connections.filter(
      (record) => record.connectionpairid === connection.connectionpairid,
    );
  assert.equal(pair.length, 2);
  assert.equal(pair[0].record1id, pair[1].record2id);
  assert.equal(pair[0].record1roleidname, pair[1].record2roleidname);

  response = await instance.fetch(
    `/api/data/v9.2/connections(${connection.connectionid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": connection["@odata.etag"],
        prefer: "return=representation",
      },
      body: { record1roleidname: "Sponsor", record2roleidname: "Partner" },
    },
  );
  assert.equal(response.status, 200);
  connection = await response.json();
  pair = instance
    .state()
    .entities.connections.filter(
      (record) => record.connectionpairid === connection.connectionpairid,
    );
  const reciprocal = pair.find((record) => record.connectionid !== connection.connectionid);
  assert.equal(reciprocal.record1roleidname, "Partner");
  assert.equal(reciprocal.record2roleidname, "Sponsor");
  response = await instance.fetch(
    `/api/data/v9.2/connections(${connection.connectionid})`,
    { method: "DELETE", headers: { "if-match": connection["@odata.etag"] } },
  );
  assert.equal(response.status, 204);
  assert.equal(
    instance
      .state()
      .entities.connections.filter(
        (record) => record.connectionpairid === connection.connectionpairid,
      ).length,
    0,
  );
  assert.equal(instance.validateIntegrity(), true);
});

test("failed creates and guards consume neither revision nor creation ordinal", async () => {
  const first = twin();
  const second = twin();
  const before = first.state().lineage;
  assert.equal(
    (
      await first.fetch("/api/data/v9.2/accounts", {
        method: "POST",
        body: { name: 123 },
      })
    ).status,
    400,
  );
  const protectedAccount = first.state().entities.accounts[0];
  assert.equal(
    (
      await first.fetch(`/api/data/v9.2/accounts(${protectedAccount.accountid})`, {
        method: "DELETE",
        headers: { "if-match": protectedAccount["@odata.etag"] },
      })
    ).status,
    409,
  );
  assert.deepEqual(first.state().lineage, before);
  const createOptions = {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: { name: "Ordinal Account" },
  };
  const afterFailure = await json(await first.fetch("/api/data/v9.2/accounts", createOptions));
  const direct = await json(await second.fetch("/api/data/v9.2/accounts", createOptions));
  assert.equal(afterFailure.accountid, direct.accountid);
  assert.equal(first.state().lineage.creationOrdinal, 1);
  assert.equal(first.state().lineage.revision, 1);
});

test("reset restores content while invalidating all pre-reset ETags", async () => {
  const first = twin();
  const second = twin();
  const baselineContent = first.contentDigest();
  const account = first.state().entities.accounts[0];
  const staleEtag = account["@odata.etag"];
  await first.fetch(`/api/data/v9.2/accounts(${account.accountid})`, {
    method: "PATCH",
    headers: { "if-match": staleEtag },
    body: { description: "Before reset" },
  });
  first.reset();
  const resetRecord = first
    .state()
    .entities.accounts.find((record) => record.accountid === account.accountid);
  assert.equal(first.contentDigest(), baselineContent);
  assert.notEqual(resetRecord["@odata.etag"], staleEtag);
  assert.equal(first.state().lineage.resetGeneration, 1);
  assert.equal(
    (
      await first.fetch(`/api/data/v9.2/accounts(${account.accountid})`, {
        method: "PATCH",
        headers: { "if-match": staleEtag },
        body: { description: "Stale reset writer" },
      })
    ).status,
    412,
  );
  const repeat = async (instance) => {
    const original = instance.state().entities.accounts[0];
    await instance.fetch(`/api/data/v9.2/accounts(${original.accountid})`, {
      method: "PATCH",
      headers: { "if-match": original["@odata.etag"] },
      body: { description: "Before reset" },
    });
    instance.reset();
  };
  await repeat(second);
  assert.equal(first.contentDigest(), second.contentDigest());
});

test("retry outcome tracking reports only the final HTTP or transport result", async () => {
  const fetchTwin = twin({
    faults: [
      { type: "network", attempt: 1 },
      { type: "http-503", attempt: 2 },
    ],
    retry: { maxAttempts: 2, baseDelayMs: 5 },
  });
  const response = await fetchTwin.fetch("/api/data/v9.2/accounts");
  assert.equal(response.status, 503);

  const requestTwin = twin({
    faults: [
      { type: "network", attempt: 1 },
      { type: "http-503", attempt: 2 },
    ],
    retry: { maxAttempts: 2, baseDelayMs: 5 },
  });
  await assert.rejects(
    requestTwin.request("/api/data/v9.2/accounts"),
    (error) =>
      error instanceof TwinRetryExhaustedError &&
      error.response?.status === 503 &&
      error.cause === null,
  );
  const recovered = twin({
    faults: [{ type: "network", attempt: 1 }],
    retry: { maxAttempts: 2, baseDelayMs: 5 },
  });
  assert.equal((await recovered.fetch("/api/data/v9.2/accounts?$top=1")).status, 200);
});

test("export and replay preserve failures, body representation, operations, and exact digests", async () => {
  const instance = twin({ retry: { maxAttempts: 2, baseDelayMs: 10 } });
  instance.setFaultPlan([{ type: "network", method: "GET", times: 2 }]);
  await assert.rejects(
    instance.fetch("/api/data/v9.2/accounts"),
    TwinRetryExhaustedError,
  );
  const account = instance.state().entities.accounts[0];
  await instance.fetch(`/api/data/v9.2/accounts(${account.accountid})`, {
    method: "PATCH",
    headers: { "if-match": account["@odata.etag"] },
    body: { description: "After exhausted network" },
  });
  await instance.fetch("/api/data/v9.2/accounts", {
    method: "POST",
    body: '{"name":"Raw JSON body"}',
  });
  await instance.fetch("/api/data/v9.2/accounts", {
    method: "POST",
    body: { name: "Object body" },
  });
  const failed = await instance.fetch("/api/data/v9.2/accounts?$select=unknown");
  assert.equal(failed.status, 400);
  instance.advanceTime(1234);
  instance.reset();
  const exported = instance.exportRun();
  const bodyKinds = exported.operations
    .filter((operation) => operation.kind === "request")
    .map((operation) => operation.request.body.kind);
  assert.ok(bodyKinds.includes("text"));
  assert.ok(bodyKinds.includes("json"));
  const representedBodies = exported.operations
    .filter(
      (operation) =>
        operation.kind === "request" &&
        ["text", "json"].includes(operation.request.body.kind),
    )
    .map((operation) => operation.request.bodyFingerprint);
  assert.equal(new Set(representedBodies).size, representedBodies.length);
  assert.ok(
    exported.operations.some(
      (operation) =>
        operation.kind === "request" && operation.outcome?.kind === "error",
    ),
  );
  const replayed = await replayRun(exported);
  assert.equal(replayed.stateDigest(), exported.finalStateDigest);
  assert.equal(replayed.contentDigest(), exported.finalContentDigest);
  assert.equal(replayed.traceDigest(), exported.traceDigest);
  assert.equal(replayed.clock.now(), exported.now);
  assert.equal(replayed.exportRun().operations.length, exported.operations.length);
  const replayedAgain = await replayRun(replayed.exportRun());
  assert.equal(replayedAgain.stateDigest(), replayed.stateDigest());
  const divergent = structuredClone(exported);
  divergent.finalStateDigest = "0".repeat(64);
  await assert.rejects(replayRun(divergent), TwinReplayDivergenceError);
});

test("strict dates reject impossible calendars and clock overflow is transactional", () => {
  assert.equal(
    normalizeUtc("2024-02-29T23:30:00.000-05:00"),
    "2024-03-01T04:30:00.000Z",
  );
  assert.throws(() => normalizeUtc("2023-02-29T00:00:00.000Z"), /valid datetime/);
  assert.throws(() => normalizeUtc("2026-02-30T00:00:00.000Z"), /valid datetime/);
  assert.throws(() => normalizeUtc("2026-01-01T24:00:00.000Z"), /valid datetime/);
  const clock = new VirtualClock(seed.epoch);
  const before = clock.now();
  assert.throws(
    () => clock.advance(Number.MAX_SAFE_INTEGER),
    /supported datetime range/,
  );
  assert.equal(clock.now(), before);
  assert.equal(clock.advance(1), "2026-01-15T12:00:00.001Z");
});

test("non-finite and non-JSON request bodies fail before mutation", async () => {
  const instance = twin();
  const before = instance.stateDigest();
  for (const body of [
    { name: Number.NaN },
    { name: Number.POSITIVE_INFINITY },
    { name: new Date("2026-01-01T00:00:00.000Z") },
  ]) {
    const response = await instance.fetch("/api/data/v9.2/accounts", {
      method: "POST",
      body,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(instance.stateDigest(), before);
});

test("core avoids host randomness, wall-clock reads, locale sorting, and dynamic evaluation", () => {
  const source = fs.readFileSync(new URL("../site/twin-core.mjs", import.meta.url), "utf8");
  for (const token of [
    "Date" + ".now",
    "Math" + ".random",
    "locale" + "Compare",
    "set" + "Timeout",
    "set" + "Interval",
    "new " + "Function",
  ]) {
    assert.equal(source.includes(token), false, token);
  }
});
