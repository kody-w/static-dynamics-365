import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createTwin } from "../site/twin-core.mjs";
import {
  CASE_STATUS_REASON_LABELS,
  NAV_GROUPS,
  PAGE_SIZE,
  applySystemView,
  caseStatusLabel,
  caseStatusReasonLabel,
  combineActivities,
  createNavigationHistory,
  dashboardComponents,
  editableSnapshotsEqual,
  initializeLookupDraft,
  lookupControlValue,
  lookupPayload,
  nextRovingTabIndex,
  paginateRows,
  preflightAccountDeletion,
  preflightBulkDeletion,
  preflightContactDeletion,
  relatedActivities,
  relatedConnectionsForContact,
  routeGuardMatches,
  replaceCreatedRecordHistory,
  runConfirmedLifecycleAction,
  safeUiBatch,
  safeUiDeleteMany,
  safeUiRequest,
  safeExternalUrl,
  searchRows,
  shouldInterceptSkipLink,
  shouldInterceptSpaNavigation,
  stableSortRows,
  taskStatusLabel,
  transitionHistoryPop,
  transitionHistoryPrompt,
  transitionPatch,
  updateSelection,
} from "../site/app-helpers.mjs";

const seed = JSON.parse(
  fs.readFileSync(new URL("../data/seed.json", import.meta.url), "utf8"),
);
const data = seed.entities;
const now = seed.epoch;

test("sitemap order matches the Customer Service Hub contract", () => {
  assert.deepEqual(
    NAV_GROUPS.map((group) => [
      group.label,
      group.items.map((item) => item.label),
    ]),
    [
      ["My Work", ["Dashboards", "Activities"]],
      ["Customers", ["Accounts", "Contacts"]],
      ["Service", ["Cases", "Queues"]],
      ["Knowledge", ["Knowledge Articles", "Knowledge Search"]],
      ["Service Management", ["Simulation settings", "API & simulation"]],
    ],
  );
});

test("activities combine every email and task with correct lifecycle labels", () => {
  const activities = combineActivities(data.emails, data.tasks, now);
  assert.equal(activities.length, 96);
  assert.equal(activities.filter((row) => row.statuslabel === "Sent").length, 30);
  assert.equal(activities.filter((row) => row.statuslabel === "Received").length, 30);
  assert.equal(activities.filter((row) => row.statuslabel === "Completed").length, 12);
  assert.equal(activities.filter((row) => row.statuslabel === "Canceled").length, 6);
  assert.ok(activities.some((row) => row.statuslabel === "Overdue"));
  assert.ok(activities.some((row) => row.statuslabel === "Open"));
});

test("system views, display search, stable sort, selection, and paging are deterministic", () => {
  const activeCases = applySystemView(data.incidents, "incidents", "active", now);
  assert.equal(activeCases.length, 15);
  assert.equal(
    applySystemView(data.incidents, "incidents", "resolved", now).length,
    7,
  );
  const displaySearch = searchRows(
    data.incidents,
    ["prioritycode"],
    "high",
    (record, field, value) => (field === "prioritycode" && value === 1 ? "High" : value),
  );
  assert.equal(displaySearch.length, 8);
  const tied = [
    { id: "b", value: "same" },
    { id: "a", value: "same" },
  ];
  assert.deepEqual(
    stableSortRows(tied, "value", "asc", "id").map((row) => row.id),
    ["a", "b"],
  );
  const activities = combineActivities(data.emails, data.tasks, now);
  const first = paginateRows(activities, 1, PAGE_SIZE);
  const second = paginateRows(activities, 2, PAGE_SIZE);
  assert.equal(first.records.length, 50);
  assert.equal(second.records.length, 46);
  assert.equal(new Set([...first.records, ...second.records].map((row) => row.activityid)).size, 96);
  let selection = updateSelection(new Set(), ["a", "b"], true);
  selection = updateSelection(selection, ["a"], false);
  assert.deepEqual([...selection], ["b"]);
});

test("dashboards have distinct derived components", () => {
  const customer = dashboardComponents(data, now, "customer-service");
  const activity = dashboardComponents(data, now, "service-activity");
  assert.equal(customer.title, "Customer Service Dashboard");
  assert.equal(activity.title, "Service Activity Dashboard");
  assert.notDeepEqual(customer.cards, activity.cards);
  assert.equal(customer.charts[0].values.reduce((sum, item) => sum + item.value, 0), 15);
  assert.equal(activity.charts[0].values.reduce((sum, item) => sum + item.value, 0), 60);
});

test("forty reciprocal rows render as twenty reachable pairs without contact duplicates", () => {
  const runtimeData = createTwin({ seed }).state().entities;
  assert.equal(runtimeData.connections.length, 40);
  const globalPairs = new Map();
  for (const connection of runtimeData.connections) {
    const rows = globalPairs.get(connection.connectionpairid) || [];
    rows.push(connection);
    globalPairs.set(connection.connectionpairid, rows);
  }
  assert.equal(globalPairs.size, 20);
  assert.ok([...globalPairs.values()].every((pair) => pair.length === 2));

  const seenPairs = new Set();
  for (const contact of runtimeData.contacts) {
    const rows = relatedConnectionsForContact(
      runtimeData.connections,
      contact.contactid,
      runtimeData.contacts,
    );
    assert.equal(
      new Set(rows.map((row) => row.connectionpairid)).size,
      rows.length,
      contact.contactid,
    );
    for (const row of rows) {
      assert.equal(row.fromid, contact.contactid);
      assert.ok(row.fromname);
      assert.ok(row.toname);
      assert.ok(row.fromrole);
      assert.ok(row.torole);
      const source = runtimeData.connections.find(
        (connection) => connection.connectionid === row.connectionid,
      );
      const sourceFacesContact = source.record1id === contact.contactid;
      assert.equal(
        row.fromrole,
        sourceFacesContact ? source.record1roleidname : source.record2roleidname,
      );
      assert.equal(
        row.torole,
        sourceFacesContact ? source.record2roleidname : source.record1roleidname,
      );
      seenPairs.add(row.connectionpairid);
    }
  }
  assert.deepEqual(seenPairs, new Set(globalPairs.keys()));
});

test("task and case labels do not infer completion from time", () => {
  const open = data.tasks.find((record) => record.statecode === 0);
  assert.equal(
    taskStatusLabel(open, "2030-01-01T00:00:00.000Z"),
    "Overdue",
  );
  assert.equal(open.statecode, 0);
  assert.equal(caseStatusLabel({ statecode: 0 }), "Active");
  assert.equal(caseStatusLabel({ statecode: 1 }), "Resolved");
  assert.equal(caseStatusLabel({ statecode: 2 }), "Canceled");
});

test("lifecycle patches are explicit and entity-specific", () => {
  assert.deepEqual(
    transitionPatch("tasks", "complete", now),
    {
      statecode: 1,
      statuscode: 5,
      percentcomplete: 100,
      actualend: now,
    },
  );
  assert.deepEqual(transitionPatch("tasks", "cancel", now), {
    statecode: 2,
    statuscode: 6,
    actualend: now,
  });
  assert.deepEqual(transitionPatch("incidents", "resolve", now), {
    statecode: 1,
    statuscode: 5,
  });

  test("case reason labels use the complete valid lifecycle vectors", () => {
    const expected = [
      [0, 1, "In Progress"],
      [0, 2, "On Hold"],
      [0, 3, "Waiting for Details"],
      [0, 4, "Researching"],
      [1, 5, "Problem Solved"],
      [1, 1000, "Information Provided"],
      [2, 6, "Canceled"],
      [2, 2000, "Merged"],
    ];
    assert.deepEqual(
      Object.entries(CASE_STATUS_REASON_LABELS).flatMap(([state, reasons]) =>
        Object.entries(reasons).map(([status, label]) => [Number(state), Number(status), label]),
      ),
      expected,
    );
    for (const [statecode, statuscode, label] of expected) {
      assert.equal(caseStatusReasonLabel({ statecode, statuscode }), label);
    }
    assert.equal(caseStatusReasonLabel({ statecode: 1, statuscode: 2 }), "Unknown");
  });
  assert.deepEqual(transitionPatch("incidents", "reopen", now), {
    statecode: 0,
    statuscode: 1,
  });
});

test("dirty lifecycle cancellation performs zero writes and preserves every draft", async () => {
  for (const entity of ["tasks", "incidents", "contacts", "accounts"]) {
    const draft = { entity, dirty: true, value: `unsaved ${entity}` };
    const writes = [];
    const outcome = await runConfirmedLifecycleAction({
      dirty: draft.dirty,
      record: { "@odata.etag": 'W/"original"' },
      requestConfirmation: async () => false,
      save: async () => {
        writes.push("save");
        draft.dirty = false;
        return { "@odata.etag": 'W/"saved"' };
      },
      transition: async () => {
        writes.push("transition");
        return { ok: true };
      },
    });
    assert.deepEqual(writes, []);
    assert.equal(draft.dirty, true);
    assert.equal(draft.value, `unsaved ${entity}`);
    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.stage, "confirmation");
  }
});

test("confirmed dirty lifecycle saves first and transitions with the saved ETag", async () => {
  const order = [];
  const saved = { "@odata.etag": 'W/"saved"', subject: "saved draft" };
  const outcome = await runConfirmedLifecycleAction({
    dirty: true,
    record: { "@odata.etag": 'W/"original"' },
    requestConfirmation: async () => {
      order.push("confirm");
      return true;
    },
    save: async () => {
      order.push("save");
      return saved;
    },
    transition: async (record) => {
      order.push(`transition:${record["@odata.etag"]}`);
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(order, ["confirm", "save", 'transition:W/"saved"']);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.actionRecord, saved);
  assert.equal(outcome.stage, "complete");
});

test("lifecycle coordinator cancellation and confirmation control real runtime writes", async () => {
  const instance = createTwin({ seed });
  const task = instance.state().entities.tasks.find((record) => record.statecode === 0);
  const draft = { description: "Saved only after confirmation", dirty: true };
  const save = async () => {
    const outcome = await safeUiRequest(
      instance,
      `/api/data/v9.2/tasks(${task.activityid})`,
      {
        method: "PATCH",
        headers: {
          "if-match": task["@odata.etag"],
          prefer: "return=representation",
        },
        body: { description: draft.description },
      },
      { expectJson: true },
    );
    if (!outcome.ok) return null;
    draft.dirty = false;
    return outcome.data;
  };
  const transition = (saved) =>
    safeUiRequest(
      instance,
      `/api/data/v9.2/tasks(${task.activityid})`,
      {
        method: "PATCH",
        headers: {
          "if-match": saved["@odata.etag"],
          prefer: "return=representation",
        },
        body: transitionPatch("tasks", "complete", instance.clock.now()),
      },
      { expectJson: true },
    );

  const before = instance.stateDigest();
  const cancelled = await runConfirmedLifecycleAction({
    dirty: draft.dirty,
    record: task,
    requestConfirmation: async () => false,
    save,
    transition,
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(instance.stateDigest(), before);
  assert.equal(draft.dirty, true);

  const confirmed = await runConfirmedLifecycleAction({
    dirty: draft.dirty,
    record: task,
    requestConfirmation: async () => true,
    save,
    transition,
  });
  assert.equal(confirmed.ok, true);
  const updated = instance
    .state()
    .entities.tasks.find((record) => record.activityid === task.activityid);
  assert.equal(updated.description, draft.description);
  assert.equal(updated.statecode, 1);
  assert.equal(updated.statuscode, 5);
  assert.equal(draft.dirty, false);
  assert.equal(
    instance.trace.filter(
      (event) => event.kind === "commit" && event.id === task.activityid,
    ).length,
    2,
  );
});

test("confirmed lifecycle reports save and transition failures by stage", async () => {
  let transitions = 0;
  const saveFailure = await runConfirmedLifecycleAction({
    dirty: true,
    requestConfirmation: async () => true,
    save: async () => null,
    transition: async () => {
      transitions += 1;
      return { ok: true };
    },
  });
  assert.equal(saveFailure.stage, "save");
  assert.equal(saveFailure.ok, false);
  assert.equal(transitions, 0);

  const transitionFailure = await runConfirmedLifecycleAction({
    dirty: true,
    requestConfirmation: async () => true,
    save: async () => ({ "@odata.etag": 'W/"saved"' }),
    transition: async () => ({ ok: false, message: "transition failed" }),
  });
  assert.equal(transitionFailure.stage, "transition");
  assert.equal(transitionFailure.result.message, "transition failed");
});

test("history state restores before a dirty navigation prompt", () => {
  const start = createNavigationHistory(4);
  const pending = transitionHistoryPop(start, 2, true);
  assert.equal(pending.currentIndex, 4);
  assert.equal(pending.phase, "restore-before-prompt");
  const stay = transitionHistoryPrompt(pending, false);
  assert.equal(stay.currentIndex, 4);
  assert.equal(stay.phase, "idle");
  const leave = transitionHistoryPrompt(pending, true);
  assert.equal(leave.currentIndex, 2);
  assert.equal(leave.phase, "navigate-target");
});

test("replacing a newly-created route preserves the physical history index", () => {
  const calls = [];
  const currentIndex = replaceCreatedRecordHistory(
    4,
    "#/accounts/created",
    (...args) => calls.push(args),
  );
  assert.equal(currentIndex, 4);
  assert.deepEqual(calls, [[{ appIndex: 4 }, "", "#/accounts/created"]]);
  const back = transitionHistoryPop(createNavigationHistory(currentIndex), 3, true);
  assert.equal(transitionHistoryPrompt(back, false).currentIndex, 4);
  assert.equal(transitionHistoryPrompt(back, true).currentIndex, 3);
  const forward = transitionHistoryPop(createNavigationHistory(3), 4, true);
  assert.equal(transitionHistoryPrompt(forward, true).currentIndex, 4);
});

test("lookup drafts survive tab rerenders and exactly match create payloads", () => {
  const vectors = [
    ["accounts", "primarycontactid", data.contacts[0].contactid, {}],
    ["contacts", "parentcustomerid", data.accounts[0].accountid, {}],
    ["incidents", "customerid", data.accounts[1].accountid, { customeridtype: "accounts" }],
    ["incidents", "primarycontactid", data.contacts[1].contactid, {}],
    ["tasks", "regardingobjectid", data.incidents[0].incidentid, { regardingobjectidtype: "incidents" }],
  ];
  for (const [entity, field, selected, extras] of vectors) {
    const draft = initializeLookupDraft(entity, null, {});
    draft[field] = selected;
    Object.assign(draft, extras);
    assert.equal(lookupControlValue(draft, field), selected);
    assert.equal(lookupControlValue({ ...draft }, field), selected);
    const payload = lookupPayload(entity, draft);
    assert.equal(payload[field], selected);
    for (const [name, value] of Object.entries(extras)) assert.equal(payload[name], value);
  }
});

test("record tabs wrap with roving keyboard behavior and skip disabled tabs", () => {
  const tabs = [{ disabled: false }, { disabled: true }, { disabled: false }];
  assert.equal(nextRovingTabIndex(tabs, 0, "ArrowRight"), 2);
  assert.equal(nextRovingTabIndex(tabs, 2, "ArrowRight"), 0);
  assert.equal(nextRovingTabIndex(tabs, 0, "ArrowLeft"), 2);
  assert.equal(nextRovingTabIndex(tabs, 0, "End"), 2);
});

test("editable snapshots clear dirty state after exact reversion", () => {
  assert.equal(
    editableSnapshotsEqual(
      { name: "Account", phone: null, priority: 2 },
      { priority: 2, phone: "", name: "Account" },
    ),
    true,
  );
  assert.equal(editableSnapshotsEqual({ value: "A" }, { value: "a" }), false);
});

test("SPA interception preserves modified and targeted clicks", () => {
  const base = {
    href: "#/accounts",
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: "",
  };
  assert.equal(shouldInterceptSpaNavigation(base), true);
  assert.equal(shouldInterceptSpaNavigation({ ...base, ctrlKey: true }), false);
  assert.equal(shouldInterceptSpaNavigation({ ...base, target: "_blank" }), false);
  assert.equal(shouldInterceptSpaNavigation({ ...base, href: "https://example.com" }), false);
});

test("skip-link interception is distinct from SPA routing and preserves the active route", () => {
  const route = "#/contacts/record-id";
  const historyIndex = 7;
  assert.equal(
    shouldInterceptSkipLink({
      href: "#main-content",
      defaultPrevented: false,
    }),
    true,
  );
  assert.equal(
    shouldInterceptSkipLink({
      href: "#main-content",
      defaultPrevented: true,
    }),
    false,
  );
  assert.equal(shouldInterceptSkipLink({ href: route, defaultPrevented: false }), false);
  assert.equal(
    shouldInterceptSpaNavigation({
      href: "#main-content",
      defaultPrevented: false,
      button: 0,
    }),
    false,
  );
  assert.equal(route, "#/contacts/record-id");
  assert.equal(historyIndex, 7);
});

test("route guards require both navigation token and route identity", () => {
  const guard = { navigationToken: 7, route: "#/accounts/a" };
  assert.equal(routeGuardMatches(guard, 7, "#/accounts/a"), true);
  assert.equal(routeGuardMatches(guard, 8, "#/accounts/a"), false);
  assert.equal(routeGuardMatches(guard, 7, "#/accounts/b"), false);
});

test("deletion preflight reports deterministic related-record blockers", () => {
  const contact = data.contacts[0];
  const contactBlocked = preflightContactDeletion(
    [contact.contactid],
    data.contacts,
    data.connections,
    data.incidents,
    data.emails,
  );
  assert.equal(contactBlocked.length, 1);
  assert.ok(contactBlocked[0].references > 0);
  const account = data.accounts[0];
  const accountBlocked = preflightAccountDeletion(
    [account.accountid],
    data.accounts,
    data.emails,
    data.incidents,
    data.contacts,
  );
  assert.equal(accountBlocked.length, 1);
  assert.ok(accountBlocked[0].references > 0);
});

test("contact deletion preflight includes a directly regarding email lookup", () => {
  const contact = data.contacts[0];
  const regardingEmail = {
    ...data.emails[0],
    activityid: "direct-regarding-contact-email",
    regardingobjectid: contact.contactid,
    regardingobjectidtype: "contacts",
    senderid: data.contacts[1].contactid,
    senderidtype: "contacts",
    recipientid: data.contacts[2].contactid,
    recipientidtype: "contacts",
  };
  const blocked = preflightContactDeletion(
    [contact.contactid],
    data.contacts,
    [],
    [],
    [regardingEmail],
    [],
    [],
  );
  assert.deepEqual(blocked, [{
    id: contact.contactid,
    name: contact.fullname,
    references: 1,
  }]);
});

test("related activities include direct account/contact lookups and contact parties without truncation", () => {
  const account = data.accounts[0];
  const contact = data.contacts[0];
  const directTasks = Array.from({ length: 30 }, (_, index) => ({
    ...data.tasks[0],
    activityid: `task-direct-${String(index).padStart(2, "0")}`,
    regardingobjectid: account.accountid,
    regardingobjectidtype: "accounts",
  }));
  const contactTask = {
    ...data.tasks[0],
    activityid: "task-contact-direct",
    regardingobjectid: contact.contactid,
    regardingobjectidtype: "contacts",
  };
  const contactEmail = {
    ...data.emails[0],
    activityid: "email-contact-direct",
    regardingobjectid: contact.contactid,
    regardingobjectidtype: "contacts",
    senderid: contact.contactid,
  };
  const extended = {
    ...data,
    tasks: [...data.tasks, ...directTasks, contactTask],
    emails: [...data.emails, contactEmail],
  };
  const accountRows = relatedActivities("accounts", account, extended, now);
  assert.ok(directTasks.every((task) => accountRows.some((row) => row.activityid === task.activityid)));
  assert.ok(accountRows.length > 25);
  const contactRows = relatedActivities("contacts", contact, extended, now);
  assert.ok(contactRows.some((row) => row.activityid === contactTask.activityid));
  assert.equal(
    contactRows.filter((row) => row.activityid === contactEmail.activityid).length,
    1,
  );
});

test("safe UI requests retry transient responses and surface final faults", async () => {
  const transient = createTwin({
    seed,
    faults: [{ type: "http-429" }],
  });
  const recovered = await safeUiRequest(transient, "/api/data/v9.2/accounts?$top=1");
  assert.equal(recovered.ok, true);
  assert.equal(transient.trace.filter((event) => event.kind === "retry").length, 1);

  for (const type of ["http-503", "network", "malformed"]) {
    const instance = createTwin({
      seed,
      faults: [{ type, times: type === "malformed" ? 1 : 2 }],
    });
    const outcome = await safeUiRequest(instance, "/api/data/v9.2/accounts?$top=1");
    assert.equal(outcome.ok, false, type);
    assert.match(outcome.message, /failed|malformed|unavailable|requests/i, type);
  }
});

test("safe UI batches never report success after a later failed operation", async () => {
  const instance = createTwin({ seed });
  const [first, second] = instance.state().entities.accounts;
  instance.setFaultPlan([
    {
      type: "http-503",
      method: "PATCH",
      pathIncludes: second.accountid,
      times: 2,
    },
  ]);
  const operations = [first, second].map((account) => ({
    input: `/api/data/v9.2/accounts(${account.accountid})`,
    init: {
      method: "PATCH",
      headers: { "if-match": account["@odata.etag"] },
      body: { description: `Batch ${account.accountid}` },
    },
  }));
  const outcome = await safeUiBatch(instance, operations);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.completed, 1);
  assert.equal(instance.validateIntegrity(), true);
  assert.equal(
    instance.state().entities.accounts.find((item) => item.accountid === second.accountid)
      .description,
    second.description,
  );
});

test("UI atomic bulk delete preflight reports zero and sends no delete for mixed selections", async () => {
  const instance = createTwin({ seed });
  const create = async (entity, body) => {
    const response = await instance.fetch(`/api/data/v9.2/${entity}`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body,
    });
    assert.equal(response.status, 201, entity);
    return response.json();
  };

  const freeAccount = await create("accounts", { name: "UI Free Account" });
  const blockedAccount = await create("accounts", { name: "UI Blocked Account" });
  await create("tasks", {
    subject: "UI account blocker",
    scheduledend: instance.clock.now(),
    regardingobjectid: blockedAccount.accountid,
    regardingobjectidtype: "accounts",
  });
  let snapshot = instance.state();
  let preflight = preflightBulkDeletion(
    "accounts",
    [freeAccount.accountid, blockedAccount.accountid],
    snapshot.entities,
  );
  assert.equal(preflight.ok, false);
  assert.equal(preflight.completed, 0);
  let before = instance.stateDigest();
  let requests = instance.exportRun().requests.length;
  let outcome = await safeUiDeleteMany(
    instance,
    "accounts",
    [freeAccount, blockedAccount],
    snapshot.entities,
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.completed, 0);
  assert.match(outcome.message, /^0 records deleted\./);
  assert.equal(instance.stateDigest(), before);
  assert.equal(instance.exportRun().requests.length, requests);

  const freeContact = await create("contacts", {
    firstname: "UI Free",
    lastname: "Contact",
    parentcustomerid: freeAccount.accountid,
  });
  const blockedContact = await create("contacts", {
    firstname: "UI Blocked",
    lastname: "Contact",
    parentcustomerid: freeAccount.accountid,
  });
  await create("emails", {
    subject: "UI contact blocker",
    directioncode: true,
    fromaddress: "support@crm.asterlane.example",
    toaddress: "ui.blocked@example.example",
    regardingobjectid: blockedContact.contactid,
    regardingobjectidtype: "contacts",
  });
  snapshot = instance.state();
  preflight = preflightBulkDeletion(
    "contacts",
    [freeContact.contactid, blockedContact.contactid],
    snapshot.entities,
  );
  assert.equal(preflight.ok, false);
  assert.equal(preflight.completed, 0);
  before = instance.stateDigest();
  requests = instance.exportRun().requests.length;
  outcome = await safeUiDeleteMany(
    instance,
    "contacts",
    [freeContact, blockedContact],
    snapshot.entities,
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.completed, 0);
  assert.match(outcome.message, /^0 records deleted\./);
  assert.equal(instance.stateDigest(), before);
  assert.equal(instance.exportRun().requests.length, requests);
  assert.equal(instance.validateIntegrity(), true);
});

test("external URL allowlist accepts only HTTP and HTTPS", () => {
  assert.equal(safeExternalUrl("https://www.cedarhollow.example"), "https://www.cedarhollow.example/");
  assert.equal(safeExternalUrl("http://www.cedarhollow.example"), "http://www.cedarhollow.example/");
  assert.equal(safeExternalUrl("javascript:example"), null);
  assert.equal(safeExternalUrl("data:text/plain,example"), null);
  assert.equal(safeExternalUrl("not a url"), null);
});
