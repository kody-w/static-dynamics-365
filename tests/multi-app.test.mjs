import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  ENTITY_DEFINITIONS,
  createTwin,
  parsePath,
  replayRun,
} from "../site/twin-core.mjs";
import { TENANT_SCHEMA } from "../site/tenant-schema.mjs";
import {
  appRoute,
  dashboardComponents,
  parseAppRoute,
} from "../site/app-helpers.mjs";

const seed = JSON.parse(
  fs.readFileSync(new URL("../data/seed.json", import.meta.url), "utf8"),
);

const twin = (options = {}) => createTwin({ seed, ...options });

async function payload(response) {
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
}

async function action(instance, name, body, headers = {}) {
  return payload(
    await instance.fetch(`/api/data/v9.2/${name}`, {
      method: "POST",
      headers,
      body,
    }),
  );
}

test("canonical schema drives every runtime and metadata entity contract", () => {
  assert.deepEqual(
    Object.keys(ENTITY_DEFINITIONS).sort(),
    Object.keys(TENANT_SCHEMA.entities).sort(),
  );
  assert.equal(seed.schemaVersion, 3);
  assert.deepEqual(seed.schema, TENANT_SCHEMA);
  assert.equal(seed.metadata.schemaDigest, seed.schemaDigest);
  for (const [entity, schema] of Object.entries(TENANT_SCHEMA.entities)) {
    const runtime = ENTITY_DEFINITIONS[entity];
    const metadata = seed.metadata.entitySets.find((item) => item.name === entity);
    assert.equal(runtime.id, schema.key);
    assert.equal(runtime.logicalName, schema.logicalName);
    assert.equal(runtime.primaryName, schema.primaryName);
    assert.equal(metadata.logicalName, schema.logicalName);
    assert.equal(metadata.entityType, schema.entityType);
    assert.equal(metadata.count, seed.entities[entity].length);
    assert.deepEqual(
      metadata.properties.map((property) => property.name).sort(),
      Object.keys(schema.fields).sort(),
    );
  }
});

test("fixture counts, identities, and cross-app anchors are exact and resolvable", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(seed.entities).map(([entity, records]) => [
        entity,
        records.length,
      ]),
    ),
    Object.fromEntries(
      Object.entries(TENANT_SCHEMA.entities).map(([entity, definition]) => [
        entity,
        definition.expectedCount,
      ]),
    ),
  );
  assert.equal(seed.entities.systemusers.length, 10);
  assert.equal(seed.entities.bookableresources.length, 4);
  assert.ok(
    seed.entities.bookableresources.every((resource) =>
      seed.entities.systemusers.some(
        (user) =>
          user.systemuserid === resource.userid &&
          user.title === "Field Service Technician",
      ),
    ),
  );
  const user = seed.entities.systemusers.find(
    (record) => record.systemuserid === seed.identity.UserId,
  );
  assert.equal(user.businessunitid, seed.identity.BusinessUnitId);
  assert.equal(seed.fixtureChains.length, 2);
  assert.ok(seed.fixtureChains.every((chain) => chain.sourceKey.startsWith("anchor.")));
});

test("fixed-point line writes atomically recalculate and restore quote totals", async () => {
  const instance = twin();
  const quote = instance.state().entities.quotes.find((record) => record.statecode === 0);
  const product = instance.state().entities.products[0];
  const unit = instance.state().entities.uoms[0];
  const before = { ...quote };
  let response = await instance.fetch("/api/data/v9.2/quotedetails", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: {
      quoteid: quote.quoteid,
      productid: product.productid,
      uomid: unit.uomid,
      quantity: "2.00",
    },
  });
  const created = await payload(response);
  assert.match(created.priceperunit, /^\d+\.\d{2}$/);
  const expectedBaseUnits =
    BigInt(created.priceperunit.replace(".", "")) * 2n;
  const expectedBaseDigits = expectedBaseUnits.toString().padStart(3, "0");
  assert.equal(
    created.baseamount,
    `${expectedBaseDigits.slice(0, -2)}.${expectedBaseDigits.slice(-2)}`,
  );
  let parent = instance
    .state()
    .entities.quotes.find((record) => record.quoteid === quote.quoteid);
  assert.notEqual(parent.totalamount, before.totalamount);

  response = await instance.fetch(
    `/api/data/v9.2/quotedetails(${created.quotedetailid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": created["@odata.etag"],
        prefer: "return=representation",
      },
      body: { manualdiscountamount: "10.00" },
    },
  );
  const discounted = await payload(response);
  assert.equal(
    BigInt(discounted.extendedamount.replace(".", "")),
    BigInt(discounted.baseamount.replace(".", "")) - 1000n,
  );
  parent = instance
    .state()
    .entities.quotes.find((record) => record.quoteid === quote.quoteid);
  assert.equal(
    BigInt(parent.totaldiscountamount.replace(".", "")) >= 1000n,
    true,
  );

  response = await instance.fetch(
    `/api/data/v9.2/quotedetails(${created.quotedetailid})`,
    {
      method: "DELETE",
      headers: { "if-match": discounted["@odata.etag"] },
    },
  );
  assert.equal(response.status, 204);
  parent = instance
    .state()
    .entities.quotes.find((record) => record.quoteid === quote.quoteid);
  for (const field of [
    "totallineitemamount",
    "totaldiscountamount",
    "totaltax",
    "totalamount",
  ]) {
    assert.equal(parent[field], before[field], field);
  }
  assert.equal(instance.validateIntegrity(), true);
});

test("sales conversion snapshots pricing and preserves complete lineage", async () => {
  const instance = twin();
  const opportunity = instance
    .state()
    .entities.opportunities.find((record) => record.statecode === 0);
  let quote = (
    await action(instance, "GenerateQuote", {
      OpportunityId: opportunity.opportunityid,
    })
  ).primary;
  quote = (
    await action(instance, "ActivateQuote", { QuoteId: quote.quoteid })
  ).primary;
  let order = (
    await action(instance, "ConvertQuoteToSalesOrder", {
      QuoteId: quote.quoteid,
    })
  ).primary;
  order = (
    await action(instance, "FulfillSalesOrder", {
      SalesOrderId: order.salesorderid,
    })
  ).primary;
  let invoice = (
    await action(instance, "ConvertSalesOrderToInvoice", {
      SalesOrderId: order.salesorderid,
    })
  ).primary;
  const quoteLines = instance
    .state()
    .entities.quotedetails.filter((line) => line.quoteid === quote.quoteid);
  const orderLines = instance
    .state()
    .entities.salesorderdetails.filter(
      (line) => line.salesorderid === order.salesorderid,
    );
  const invoiceLines = instance
    .state()
    .entities.invoicedetails.filter(
      (line) => line.invoiceid === invoice.invoiceid,
    );
  assert.deepEqual(
    orderLines.map((line) => line.quotedetailid).sort(),
    quoteLines.map((line) => line.quotedetailid).sort(),
  );
  assert.deepEqual(
    invoiceLines.map((line) => line.salesorderdetailid).sort(),
    orderLines.map((line) => line.salesorderdetailid).sort(),
  );
  assert.equal(quote.totalamount, order.totalamount);
  assert.equal(order.totalamount, invoice.totalamount);

  const price = instance.state().entities.productpricelevels.find(
    (record) =>
      record.productid === quoteLines[0].productid &&
      record.pricelevelid === quote.pricelevelid,
  );
  const snapshot = invoiceLines[0].priceperunit;
  await payload(
    await instance.fetch(
      `/api/data/v9.2/productpricelevels(${price.productpricelevelid})`,
      {
        method: "PATCH",
        headers: {
          "if-match": price["@odata.etag"],
          prefer: "return=representation",
        },
        body: { amount: "9999.00" },
      },
    ),
  );
  invoice = instance
    .state()
    .entities.invoices.find((record) => record.invoiceid === invoice.invoiceid);
  assert.equal(
    instance
      .state()
      .entities.invoicedetails.find(
        (line) => line.invoicedetailid === invoiceLines[0].invoicedetailid,
      ).priceperunit,
    snapshot,
  );
  assert.equal(invoice.totalamount, order.totalamount);
});

test("sales transitions reject illegal, stale, and direct closed-record writes", async () => {
  const instance = twin();
  const opportunity = instance
    .state()
    .entities.opportunities.find((record) => record.statecode === 0);
  const stale = opportunity["@odata.etag"];
  const won = (
    await action(
      instance,
      "WinOpportunity",
      { OpportunityId: opportunity.opportunityid },
      { "if-match": stale },
    )
  ).primary;
  let response = await instance.fetch("/api/data/v9.2/LoseOpportunity", {
    method: "POST",
    body: { OpportunityId: opportunity.opportunityid },
  });
  assert.equal(response.status, 400);
  response = await instance.fetch("/api/data/v9.2/ReopenOpportunity", {
    method: "POST",
    headers: { "if-match": stale },
    body: { OpportunityId: opportunity.opportunityid },
  });
  assert.equal(response.status, 412);
  response = await instance.fetch(
    `/api/data/v9.2/opportunities(${opportunity.opportunityid})`,
    {
      method: "PATCH",
      headers: { "if-match": won["@odata.etag"] },
      body: { description: "Forbidden closed edit" },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(instance.validateIntegrity(), true);
});

test("remaining Sales lifecycle actions follow their legal state vectors", async () => {
  const instance = twin();
  let lead = instance.state().entities.leads.find((record) => record.statecode === 0);
  lead = (
    await action(instance, "DisqualifyLead", {
      LeadId: lead.leadid,
      Status: 6,
    })
  ).primary;
  assert.deepEqual([lead.statecode, lead.statuscode], [2, 6]);
  lead = (
    await action(instance, "ReopenLead", { LeadId: lead.leadid })
  ).primary;
  assert.deepEqual([lead.statecode, lead.statuscode], [0, 1]);
  const qualification = await action(instance, "QualifyLead", {
    LeadId: lead.leadid,
    CreateAccount: true,
    CreateContact: true,
    CreateOpportunity: true,
    AccountName: "Qualified Example Account",
  });
  assert.equal(qualification.primary.statecode, 1);
  assert.deepEqual(
    qualification.created.map((item) => item.entity).sort(),
    ["accounts", "contacts", "opportunities"],
  );

  let quote = instance.state().entities.quotes.find((record) => record.statecode === 0);
  quote = (
    await action(instance, "ActivateQuote", { QuoteId: quote.quoteid })
  ).primary;
  const revision = await action(instance, "ReviseQuote", {
    QuoteId: quote.quoteid,
  });
  assert.deepEqual(
    [revision.primary.statecode, revision.primary.statuscode],
    [3, 6],
  );
  const revisedId = revision.created.find((item) => item.entity === "quotes").id;
  let revised = instance
    .state()
    .entities.quotes.find((record) => record.quoteid === revisedId);
  revised = (
    await action(instance, "ActivateQuote", { QuoteId: revised.quoteid })
  ).primary;
  const closed = (
    await action(instance, "CloseQuote", {
      QuoteId: revised.quoteid,
      Status: 5,
    })
  ).primary;
  assert.deepEqual([closed.statecode, closed.statuscode], [3, 5]);

  let activeQuote = instance.state().entities.quotes.find(
    (record) => record.statecode === 1,
  );
  activeQuote = (
    await action(instance, "WinQuote", { QuoteId: activeQuote.quoteid })
  ).primary;
  assert.deepEqual([activeQuote.statecode, activeQuote.statuscode], [2, 3]);

  const order = instance.state().entities.salesorders.find(
    (record) => record.statecode === 0,
  );
  const canceledOrder = (
    await action(instance, "CancelSalesOrder", {
      SalesOrderId: order.salesorderid,
    })
  ).primary;
  assert.deepEqual([canceledOrder.statecode, canceledOrder.statuscode], [2, 5]);
  const invoice = instance.state().entities.invoices.find(
    (record) => record.statecode === 0,
  );
  const canceledInvoice = (
    await action(instance, "CancelInvoice", { InvoiceId: invoice.invoiceid })
  ).primary;
  assert.deepEqual([canceledInvoice.statecode, canceledInvoice.statuscode], [2, 4]);
  assert.equal(instance.validateIntegrity(), true);
});

test("CloseIncident creates a resolution atomically and replay reproduces it", async () => {
  const instance = twin();
  const incident = instance.state().entities.incidents.find(
    (record) => record.statecode === 0,
  );
  const before = instance.state().entities.incidentresolutions.length;
  const result = await action(
    instance,
    "CloseIncident",
    {
      IncidentId: incident.incidentid,
      Status: 1000,
      Description: "Synthetic resolution.",
    },
    { "if-match": incident["@odata.etag"] },
  );
  assert.equal(result.primary.statecode, 1);
  assert.equal(result.primary.statuscode, 1000);
  assert.equal(instance.state().entities.incidentresolutions.length, before + 1);
  const replayed = await replayRun(instance.exportRun());
  assert.equal(replayed.stateDigest(), instance.stateDigest());
  assert.equal(replayed.traceDigest(), instance.traceDigest());
});

test("post-commit loss retries a compound action without duplicate children", async () => {
  const instance = twin({
    faults: [{ type: "post-commit-loss", method: "POST", entity: "opportunities" }],
    retry: { maxAttempts: 2, baseDelayMs: 10 },
  });
  const opportunity = instance
    .state()
    .entities.opportunities.find((record) => record.statecode === 0);
  const quotesBefore = instance.state().entities.quotes.length;
  const linesBefore = instance.state().entities.quotedetails.length;
  const sourceLines = instance
    .state()
    .entities.opportunityproducts.filter(
      (line) => line.opportunityid === opportunity.opportunityid,
    ).length;
  const response = await instance.fetch("/api/data/v9.2/GenerateQuote", {
    method: "POST",
    headers: { "x-logical-request-id": "compound-quote-retry" },
    body: { OpportunityId: opportunity.opportunityid },
  });
  assert.equal(response.status, 200);
  assert.equal(instance.state().entities.quotes.length, quotesBefore + 1);
  assert.equal(
    instance.state().entities.quotedetails.length,
    linesBefore + sourceLines,
  );
  assert.equal(
    instance.trace.filter(
      (event) =>
        event.kind === "idempotent-replay" &&
        event.logicalRequestId === "compound-quote-retry",
    ).length,
    1,
  );
});

test("booking overlap uses normalized UTC half-open boundaries", async () => {
  const instance = twin();
  const incident = instance.state().entities.incidents[0];
  const create = async (suffix) =>
    (
      await action(instance, "CreateWorkOrder", {
        CaseId: incident.incidentid,
        WindowStart: "2031-01-10T13:00:00Z",
        WindowEnd: "2031-01-10T17:00:00Z",
        Instructions: suffix,
      })
    ).primary;
  const workorders = [
    await create("first"),
    await create("second"),
    await create("third"),
  ];
  const resource = instance.state().entities.bookableresources[0];
  await action(instance, "ScheduleWorkOrder", {
    WorkOrderId: workorders[0].msdyn_workorderid,
    ResourceId: resource.bookableresourceid,
    StartTime: "2031-01-10T08:00:00-05:00",
    EndTime: "2031-01-10T10:00:00-05:00",
  });
  const boundary = await instance.fetch("/api/data/v9.2/ScheduleWorkOrder", {
    method: "POST",
    body: {
      WorkOrderId: workorders[1].msdyn_workorderid,
      ResourceId: resource.bookableresourceid,
      StartTime: "2031-01-10T15:00:00Z",
      EndTime: "2031-01-10T17:00:00Z",
    },
  });
  assert.equal(boundary.status, 200);
  const before = instance.stateDigest();
  const count = instance.state().entities.bookableresourcebookings.length;
  const overlap = await instance.fetch("/api/data/v9.2/ScheduleWorkOrder", {
    method: "POST",
    body: {
      WorkOrderId: workorders[2].msdyn_workorderid,
      ResourceId: resource.bookableresourceid,
      StartTime: "2031-01-10T14:30:00Z",
      EndTime: "2031-01-10T15:30:00Z",
    },
  });
  assert.equal(overlap.status, 400);
  assert.equal(instance.stateDigest(), before);
  assert.equal(instance.state().entities.bookableresourcebookings.length, count);
});

test("Field Service process requires terminal bookings and completed tasks", async () => {
  const instance = twin();
  const incident = instance.state().entities.incidents.find(
    (record) => record.statecode === 0,
  );
  let workorder = (
    await action(instance, "CreateWorkOrder", { CaseId: incident.incidentid })
  ).primary;
  const resource = instance.state().entities.bookableresources[1];
  const requirement = instance
    .state()
    .entities.msdyn_resourcerequirements.find(
      (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
    );
  workorder = (
    await action(instance, "ScheduleWorkOrder", {
      WorkOrderId: workorder.msdyn_workorderid,
      ResourceId: resource.bookableresourceid,
      StartTime: requirement.msdyn_fromdate,
      EndTime: new Date(
        Date.parse(requirement.msdyn_fromdate) + 2 * 3600000,
      ).toISOString(),
    })
  ).primary;
  await action(instance, "DispatchWorkOrder", {
    WorkOrderId: workorder.msdyn_workorderid,
  });
  await action(instance, "StartWorkOrder", {
    WorkOrderId: workorder.msdyn_workorderid,
  });
  const before = instance.stateDigest();
  let response = await instance.fetch("/api/data/v9.2/CompleteWorkOrder", {
    method: "POST",
    body: { WorkOrderId: workorder.msdyn_workorderid },
  });
  assert.equal(response.status, 400);
  assert.equal(instance.stateDigest(), before);

  const booking = instance
    .state()
    .entities.bookableresourcebookings.find(
      (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
    );
  await action(instance, "CompleteBooking", {
    BookingId: booking.bookableresourcebookingid,
  });
  for (const task of instance
    .state()
    .entities.msdyn_workorderservicetasks.filter(
      (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
    )) {
    const response = await instance.fetch(
      `/api/data/v9.2/msdyn_workorderservicetasks(${task.msdyn_workorderservicetaskid})`,
      {
        method: "PATCH",
        headers: { "if-match": task["@odata.etag"] },
        body: { msdyn_percentcomplete: 100 },
      },
    );
    assert.equal(response.status, 204);
  }
  workorder = (
    await action(instance, "CompleteWorkOrder", {
      WorkOrderId: workorder.msdyn_workorderid,
    })
  ).primary;
  assert.equal(workorder.msdyn_systemstatus, 690970003);
  assert.equal(workorder.statecode, 1);
  const reopened = (
    await action(instance, "ReopenWorkOrder", {
      WorkOrderId: workorder.msdyn_workorderid,
    })
  ).primary;
  assert.equal(reopened.msdyn_systemstatus, 690970000);
  assert.equal(reopened.statecode, 0);
  assert.equal(instance.validateIntegrity(), true);
});

test("cross-app name propagation updates sales and field displays and guards delete", async () => {
  const instance = twin();
  const account = instance.state().entities.accounts.find((candidate) =>
    instance.state().entities.msdyn_customerassets.some(
      (asset) => asset.msdyn_account === candidate.accountid,
    ),
  );
  const response = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": account["@odata.etag"],
        prefer: "return=representation",
      },
      body: { name: "Aster Lane Synthetic Anchor" },
    },
  );
  const updated = await payload(response);
  const state = instance.state().entities;
  assert.ok(
    state.opportunities
      .filter((record) => record.parentaccountid === account.accountid)
      .every((record) => record.parentaccountidname === updated.name),
  );
  assert.ok(
    state.msdyn_customerassets
      .filter((record) => record.msdyn_account === account.accountid)
      .every((record) => record.msdyn_accountname === updated.name),
  );
  assert.ok(
    state.msdyn_workorders
      .filter((record) => record.msdyn_serviceaccount === account.accountid)
      .every((record) => record.msdyn_serviceaccountname === updated.name),
  );
  const deletion = await instance.fetch(
    `/api/data/v9.2/accounts(${account.accountid})`,
    {
      method: "DELETE",
      headers: { "if-match": updated["@odata.etag"] },
    },
  );
  assert.equal(deletion.status, 409);
  assert.equal(instance.validateIntegrity(), true);
});

test("runtime metadata counts track compound action commits", async () => {
  const instance = twin();
  const metadata = async () =>
    (await payload(await instance.fetch("/api/data/v9.2/$metadata"))).entitySets;
  const count = async (entity) =>
    (await metadata()).find((item) => item.name === entity).count;
  const beforeQuotes = await count("quotes");
  const beforeLines = await count("quotedetails");
  const opportunity = instance
    .state()
    .entities.opportunities.find((record) => record.statecode === 0);
  const sourceLineCount = instance
    .state()
    .entities.opportunityproducts.filter(
      (line) => line.opportunityid === opportunity.opportunityid,
    ).length;
  await action(instance, "GenerateQuote", {
    OpportunityId: opportunity.opportunityid,
  });
  assert.equal(await count("quotes"), beforeQuotes + 1);
  assert.equal(await count("quotedetails"), beforeLines + sourceLineCount);
});

test("expanded decimal queries are typed and old seed versions fail clearly", async () => {
  const instance = twin();
  let response = await instance.fetch(
    "/api/data/v9.2/invoices?$filter=totalamount%20gt%201000.00&$orderby=totalamount%20desc",
  );
  const result = await payload(response);
  assert.ok(result.value.every((record) => BigInt(record.totalamount.replace(".", "")) > 100000n));
  response = await instance.fetch(
    "/api/data/v9.2/invoices?$filter=totalamount%20gt%201000.001",
  );
  assert.equal(response.status, 400);
  const legacy = structuredClone(seed);
  legacy.schemaVersion = 2;
  assert.throws(
    () => createTwin({ seed: legacy }),
    /schemaVersion 2 is not compatible/,
  );
});

test("one run touching all apps resets and replays to exact digests", async () => {
  const instance = twin();
  const account = instance.state().entities.accounts[0];
  await payload(
    await instance.fetch(`/api/data/v9.2/accounts(${account.accountid})`, {
      method: "PATCH",
      headers: {
        "if-match": account["@odata.etag"],
        prefer: "return=representation",
      },
      body: { description: "Cross-app deterministic run." },
    }),
  );
  const lead = instance.state().entities.leads.find((record) => record.statecode === 0);
  await action(instance, "DisqualifyLead", { LeadId: lead.leadid, Status: 4 });
  const booking = instance
    .state()
    .entities.bookableresourcebookings.find((record) => record.statecode === 0);
  await action(instance, "CancelBooking", {
    BookingId: booking.bookableresourcebookingid,
  });
  instance.advanceTime(12345);
  const run = instance.exportRun();
  assert.equal(run.schemaVersion, 3);
  const replayed = await replayRun(run);
  assert.equal(replayed.stateDigest(), run.finalStateDigest);
  assert.equal(replayed.contentDigest(), run.finalContentDigest);
  assert.equal(replayed.traceDigest(), run.traceDigest);
  const baseline = twin().contentDigest();
  replayed.reset();
  assert.equal(replayed.contentDigest(), baseline);
});

test("Sales and catalog headers accept valid POST creates", async () => {
  const instance = twin();
  const state = instance.state().entities;
  const account = state.accounts[0];
  const currency = state.transactioncurrencies.find(
    (record) => record.isocurrencycode === "USD" && record.statecode === 0,
  );
  const priceList = state.pricelevels.find(
    (record) =>
      record.statecode === 0 &&
      record.transactioncurrencyid === currency.transactioncurrencyid,
  );
  const unit = state.uoms[0];
  const vectors = {
    leads: {
      subject: "Synthetic POST lead",
      firstname: "Robin",
      lastname: "Vale",
      companyname: "Vale Example",
      transactioncurrencyid: currency.transactioncurrencyid,
    },
    opportunities: {
      name: "Synthetic POST opportunity",
      customerid: account.accountid,
      customeridtype: "accounts",
      pricelevelid: priceList.pricelevelid,
      transactioncurrencyid: currency.transactioncurrencyid,
      estimatedclosedate: "2035-01-01T00:00:00Z",
    },
    quotes: {
      name: "Synthetic POST quote",
      customerid: account.accountid,
      customeridtype: "accounts",
      pricelevelid: priceList.pricelevelid,
      transactioncurrencyid: currency.transactioncurrencyid,
    },
    salesorders: {
      name: "Synthetic POST order",
      customerid: account.accountid,
      customeridtype: "accounts",
      pricelevelid: priceList.pricelevelid,
      transactioncurrencyid: currency.transactioncurrencyid,
    },
    invoices: {
      name: "Synthetic POST invoice",
      customerid: account.accountid,
      customeridtype: "accounts",
      pricelevelid: priceList.pricelevelid,
      transactioncurrencyid: currency.transactioncurrencyid,
    },
    products: {
      name: "Synthetic POST product",
      productnumber: "SYN-POST-001",
      defaultuomid: unit.uomid,
      transactioncurrencyid: currency.transactioncurrencyid,
    },
    pricelevels: {
      name: "Synthetic POST price list",
      transactioncurrencyid: currency.transactioncurrencyid,
    },
  };
  for (const [entity, body] of Object.entries(vectors)) {
    const response = await instance.fetch(`/api/data/v9.2/${entity}`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body,
    });
    assert.equal(response.status, 201, `${entity}: ${await response.text()}`);
  }
  const product = instance
    .state()
    .entities.products.find((record) => record.productnumber === "SYN-POST-001");
  assert.equal(product.defaultuomscheduleid, unit.uomscheduleid);
  assert.equal(product.defaultuomscheduleidname, unit.uomscheduleidname);
  assert.equal(instance.validateIntegrity(), true);
});

test("compound action validation is atomic and consumes no revisions or ordinals", async () => {
  const instance = twin();
  const state = instance.state().entities;
  const incident = state.incidents.find((record) => record.statecode === 0);
  const opportunity = state.opportunities.find((record) => record.statecode === 0);
  const workorder = state.msdyn_workorders.find(
    (record) => record.msdyn_systemstatus === 690970000,
  );
  const requirement = state.msdyn_resourcerequirements.find(
    (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
  );
  const invalid = [
    ["CloseIncident", { IncidentId: incident.incidentid, ActualDurationMinutes: -1 }],
    ["CloseIncident", { IncidentId: incident.incidentid, Unexpected: true }],
    ["CloseIncident", { IncidentId: incident.incidentid, Status: 6 }],
    [
      "GenerateQuote",
      {
        OpportunityId: opportunity.opportunityid,
        DiscountAmount: "999999999.00",
      },
    ],
    [
      "ScheduleWorkOrder",
      {
        WorkOrderId: workorder.msdyn_workorderid,
        ResourceId: "00000000-0000-4000-8000-000000000001",
        StartTime: requirement.msdyn_fromdate,
        EndTime: requirement.msdyn_todate,
      },
    ],
  ];
  const before = instance.stateDigest();
  const lineage = instance.state().lineage;
  const commits = instance.trace.filter((event) => event.kind === "commit").length;
  for (const [name, body] of invalid) {
    const response = await instance.fetch(`/api/data/v9.2/${name}`, {
      method: "POST",
      body,
    });
    assert.equal(response.status, 400, `${name}: ${await response.text()}`);
    assert.equal(instance.stateDigest(), before);
    assert.deepEqual(instance.state().lineage, lineage);
  }
  assert.equal(
    instance.trace.filter((event) => event.kind === "commit").length,
    commits,
  );
});

test("Sales currency, price-list, exchange-rate, and nonnegative invariants are atomic", async () => {
  const instance = twin();
  const state = instance.state().entities;
  const quote = state.quotes.find(
    (record) =>
      record.statecode === 0 &&
      state.quotedetails.some((line) => line.quoteid === record.quoteid),
  );
  const line = state.quotedetails.find((record) => record.quoteid === quote.quoteid);
  const cad = state.transactioncurrencies.find(
    (record) => record.isocurrencycode === "CAD",
  );
  const cadList = state.pricelevels.find(
    (record) =>
      record.statecode === 0 &&
      record.transactioncurrencyid === cad.transactioncurrencyid,
  );
  let response = await instance.fetch(
    `/api/data/v9.2/quotes(${quote.quoteid})`,
    {
      method: "PATCH",
      headers: { "if-match": quote["@odata.etag"] },
      body: {
        pricelevelid: cadList.pricelevelid,
        transactioncurrencyid: cad.transactioncurrencyid,
      },
    },
  );
  assert.equal(response.status, 400);
  response = await instance.fetch("/api/data/v9.2/quotedetails", {
    method: "POST",
    body: {
      quoteid: quote.quoteid,
      productid: line.productid,
      uomid: line.uomid,
      quantity: "1.00",
      transactioncurrencyid: cad.transactioncurrencyid,
    },
  });
  assert.equal(response.status, 400);

  const lead = state.leads.find(
    (record) =>
      record.statecode === 0 &&
      record.transactioncurrencyid !== cad.transactioncurrencyid,
  );
  response = await instance.fetch("/api/data/v9.2/QualifyLead", {
    method: "POST",
    body: {
      LeadId: lead.leadid,
      PriceLevelId: cadList.pricelevelid,
      CreateOpportunity: true,
    },
  });
  assert.equal(response.status, 400);

  for (const body of [
    { freightamount: "-0.01" },
    { discountamount: "-0.01" },
  ]) {
    response = await instance.fetch(
      `/api/data/v9.2/quotes(${quote.quoteid})`,
      {
        method: "PATCH",
        headers: { "if-match": quote["@odata.etag"] },
        body,
      },
    );
    assert.equal(response.status, 400);
  }
  for (const body of [
    { quantity: "0.00" },
    { priceperunit: "-0.01" },
    { manualdiscountamount: "-0.01" },
    { tax: "-0.01" },
  ]) {
    response = await instance.fetch(
      `/api/data/v9.2/quotedetails(${line.quotedetailid})`,
      {
        method: "PATCH",
        headers: { "if-match": line["@odata.etag"] },
        body,
      },
    );
    assert.equal(response.status, 400);
  }
  response = await instance.fetch(
    `/api/data/v9.2/quotes(${quote.quoteid})`,
    {
      method: "PATCH",
      headers: { "if-match": quote["@odata.etag"] },
      body: { freightamount: "0.00", discountamount: "0.00" },
    },
  );
  assert.equal(response.status, 204);
  const usd = state.transactioncurrencies.find(
    (record) => record.isocurrencycode === "USD" && record.statecode === 0,
  );
  const before = instance.stateDigest();
  response = await instance.fetch(
    `/api/data/v9.2/transactioncurrencies(${usd.transactioncurrencyid})`,
    {
      method: "PATCH",
      headers: { "if-match": usd["@odata.etag"] },
      body: { exchangerate: "1.100000" },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(instance.stateDigest(), before);
  assert.equal(instance.validateIntegrity(), true);
});

test("requirement windows, resource state, and scheduling transitions are exact", async () => {
  const instance = twin();
  const incident = instance.state().entities.incidents.find(
    (record) => record.statecode === 0,
  );
  const created = await action(instance, "CreateWorkOrder", {
    CaseId: incident.incidentid,
    WindowStart: "2035-02-03T09:00:00-05:00",
  });
  const workorder = created.primary;
  const requirement = instance
    .state()
    .entities.msdyn_resourcerequirements.find(
      (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
    );
  assert.equal(requirement.msdyn_fromdate, "2035-02-03T14:00:00.000Z");
  assert.equal(requirement.msdyn_todate, "2035-02-03T18:00:00.000Z");

  const beforeInvalidWindow = instance.stateDigest();
  let response = await instance.fetch("/api/data/v9.2/CreateWorkOrder", {
    method: "POST",
    body: {
      CaseId: incident.incidentid,
      WindowStart: "2035-02-03T09:00:00-05:00",
      WindowEnd: "2035-02-03T14:00:00Z",
    },
  });
  assert.equal(response.status, 400);
  assert.equal(instance.stateDigest(), beforeInvalidWindow);

  const resource = instance.state().entities.bookableresources[0];
  const scheduled = await action(instance, "ScheduleWorkOrder", {
    WorkOrderId: workorder.msdyn_workorderid,
    ResourceId: resource.bookableresourceid,
    StartTime: requirement.msdyn_fromdate,
    EndTime: requirement.msdyn_todate,
  });
  assert.equal(scheduled.primary.msdyn_systemstatus, 690970001);

  const another = (
    await action(instance, "CreateWorkOrder", {
      CaseId: incident.incidentid,
      WindowStart: "2035-02-04T14:00:00Z",
      WindowEnd: "2035-02-04T18:00:00Z",
    })
  ).primary;
  const anotherRequirement = instance
    .state()
    .entities.msdyn_resourcerequirements.find(
      (record) => record.msdyn_workorder === another.msdyn_workorderid,
    );
  response = await instance.fetch("/api/data/v9.2/ScheduleWorkOrder", {
    method: "POST",
    body: {
      WorkOrderId: another.msdyn_workorderid,
      ResourceId: resource.bookableresourceid,
      StartTime: "2035-02-04T13:59:59Z",
      EndTime: anotherRequirement.msdyn_todate,
    },
  });
  assert.equal(response.status, 400);

  const inactiveRequirementWorkOrder = (
    await action(instance, "CreateWorkOrder", {
      CaseId: incident.incidentid,
      WindowStart: "2035-02-05T14:00:00Z",
      WindowEnd: "2035-02-05T18:00:00Z",
    })
  ).primary;
  let inactiveRequirement = instance
    .state()
    .entities.msdyn_resourcerequirements.find(
      (record) =>
        record.msdyn_workorder ===
        inactiveRequirementWorkOrder.msdyn_workorderid,
    );
  response = await instance.fetch(
    `/api/data/v9.2/msdyn_resourcerequirements(${inactiveRequirement.msdyn_resourcerequirementid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": inactiveRequirement["@odata.etag"],
        prefer: "return=representation",
      },
      body: { statecode: 1, statuscode: 2 },
    },
  );
  inactiveRequirement = await payload(response);
  response = await instance.fetch("/api/data/v9.2/ScheduleWorkOrder", {
    method: "POST",
    body: {
      WorkOrderId: inactiveRequirementWorkOrder.msdyn_workorderid,
      ResourceId: resource.bookableresourceid,
      StartTime: inactiveRequirement.msdyn_fromdate,
      EndTime: inactiveRequirement.msdyn_todate,
    },
  });
  assert.equal(response.status, 400);

  const user = instance.state().entities.systemusers[0];
  const resourceTemplate = instance.state().entities.bookableresources[0];
  const inactiveResourceResponse = await instance.fetch(
    "/api/data/v9.2/bookableresources",
    {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: {
        name: "Inactive synthetic resource",
        userid: user.systemuserid,
        resourcetype: resourceTemplate.resourcetype,
        timezone: resourceTemplate.timezone,
        statecode: 1,
        statuscode: 2,
      },
    },
  );
  const inactiveResource = await payload(inactiveResourceResponse);
  response = await instance.fetch("/api/data/v9.2/ScheduleWorkOrder", {
    method: "POST",
    body: {
      WorkOrderId: another.msdyn_workorderid,
      ResourceId: inactiveResource.bookableresourceid,
      StartTime: anotherRequirement.msdyn_fromdate,
      EndTime: anotherRequirement.msdyn_todate,
    },
  });
  assert.equal(response.status, 400);

  const inProgress = instance.state().entities.msdyn_workorders.find(
    (record) => record.msdyn_systemstatus === 690970002,
  );
  const inProgressRequirement = instance
    .state()
    .entities.msdyn_resourcerequirements.find(
      (record) => record.msdyn_workorder === inProgress.msdyn_workorderid,
    );
  response = await instance.fetch("/api/data/v9.2/ScheduleWorkOrder", {
    method: "POST",
    body: {
      WorkOrderId: inProgress.msdyn_workorderid,
      ResourceId: resource.bookableresourceid,
      StartTime: inProgressRequirement.msdyn_fromdate,
      EndTime: inProgressRequirement.msdyn_todate,
    },
  });
  assert.equal(response.status, 400);
  assert.equal(
    instance
      .state()
      .entities.msdyn_workorders.find(
        (record) => record.msdyn_workorderid === inProgress.msdyn_workorderid,
      ).msdyn_systemstatus,
    690970002,
  );
  const terminal = instance.state().entities.msdyn_workorders.find(
    (record) => record.statecode === 1,
  );
  const terminalRequirement = instance
    .state()
    .entities.msdyn_resourcerequirements.find(
      (record) => record.msdyn_workorder === terminal.msdyn_workorderid,
    );
  response = await instance.fetch("/api/data/v9.2/ScheduleWorkOrder", {
    method: "POST",
    body: {
      WorkOrderId: terminal.msdyn_workorderid,
      ResourceId: resource.bookableresourceid,
      StartTime: terminalRequirement.msdyn_fromdate,
      EndTime: terminalRequirement.msdyn_todate,
    },
  });
  assert.equal(response.status, 400);
  assert.equal(
    instance
      .state()
      .entities.msdyn_workorders.find(
        (record) => record.msdyn_workorderid === terminal.msdyn_workorderid,
      ).msdyn_systemstatus,
    terminal.msdyn_systemstatus,
  );

  const currentRequirement = instance
    .state()
    .entities.msdyn_resourcerequirements.find(
      (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
    );
  response = await instance.fetch(
    `/api/data/v9.2/msdyn_resourcerequirements(${currentRequirement.msdyn_resourcerequirementid})`,
    {
      method: "PATCH",
      headers: { "if-match": currentRequirement["@odata.etag"] },
      body: { msdyn_todate: currentRequirement.msdyn_fromdate },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(instance.validateIntegrity(), true);
});

test("generic Field Service child CRUD preserves projected parent aggregates", async () => {
  const instance = twin();
  const state = instance.state().entities;
  const parent = state.msdyn_workorders.find(
    (record) => record.msdyn_systemstatus === 690970000,
  );
  const primary = state.msdyn_resourcerequirements.find(
    (record) => record.msdyn_workorder === parent.msdyn_workorderid,
  );
  let response = await instance.fetch(
    "/api/data/v9.2/msdyn_resourcerequirements",
    {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: {
        msdyn_name: "Secondary requirement",
        msdyn_workorder: parent.msdyn_workorderid,
        msdyn_fromdate: primary.msdyn_fromdate,
        msdyn_todate: primary.msdyn_todate,
        msdyn_duration: 30,
        msdyn_isprimary: false,
      },
    },
  );
  let secondary = await payload(response);
  response = await instance.fetch(
    `/api/data/v9.2/msdyn_resourcerequirements(${secondary.msdyn_resourcerequirementid})`,
    {
      method: "PATCH",
      headers: {
        "if-match": secondary["@odata.etag"],
        prefer: "return=representation",
      },
      body: { msdyn_name: "Updated secondary requirement" },
    },
  );
  secondary = await payload(response);
  response = await instance.fetch(
    `/api/data/v9.2/msdyn_resourcerequirements(${secondary.msdyn_resourcerequirementid})`,
    {
      method: "DELETE",
      headers: { "if-match": secondary["@odata.etag"] },
    },
  );
  assert.equal(response.status, 204);

  const invalidOperations = [
    () =>
      instance.fetch("/api/data/v9.2/msdyn_resourcerequirements", {
        method: "POST",
        body: {
          msdyn_name: "Duplicate primary requirement",
          msdyn_workorder: parent.msdyn_workorderid,
          msdyn_fromdate: primary.msdyn_fromdate,
          msdyn_todate: primary.msdyn_todate,
          msdyn_duration: 30,
          msdyn_isprimary: true,
        },
      }),
    () => instance.fetch(
      `/api/data/v9.2/msdyn_resourcerequirements(${primary.msdyn_resourcerequirementid})`,
      {
        method: "PATCH",
        headers: { "if-match": primary["@odata.etag"] },
        body: { msdyn_isprimary: false },
      },
    ),
    () => instance.fetch(
      `/api/data/v9.2/msdyn_resourcerequirements(${primary.msdyn_resourcerequirementid})`,
      {
        method: "DELETE",
        headers: { "if-match": primary["@odata.etag"] },
      },
    ),
  ];
  for (const operation of invalidOperations) {
    assert.equal((await operation()).status, 400);
  }

  const terminal = state.msdyn_workorders.find(
    (record) => record.msdyn_systemstatus === 690970003,
  );
  const terminalChildren = [
    ["msdyn_resourcerequirements", "msdyn_resourcerequirementid", "msdyn_name"],
    ["msdyn_workorderservicetasks", "msdyn_workorderservicetaskid", "msdyn_description"],
    ["msdyn_workorderproducts", "msdyn_workorderproductid", "msdyn_name"],
    ["msdyn_workorderservices", "msdyn_workorderserviceid", "msdyn_name"],
    ["msdyn_workorderincidents", "msdyn_workorderincidentid", "msdyn_name"],
    ["bookableresourcebookings", "bookableresourcebookingid", "name"],
  ];
  for (const [entity, idField, mutableField] of terminalChildren) {
    const child = instance
      .state()
      .entities[entity].find(
        (record) => record.msdyn_workorder === terminal.msdyn_workorderid,
      );
    assert.ok(child, entity);
    response = await instance.fetch(`/api/data/v9.2/${entity}(${child[idField]})`, {
      method: "PATCH",
      headers: { "if-match": child["@odata.etag"] },
      body: { [mutableField]: "Forbidden terminal child edit" },
    });
    assert.equal(response.status, 400, entity);
    response = await instance.fetch(`/api/data/v9.2/${entity}(${child[idField]})`, {
      method: "DELETE",
      headers: { "if-match": child["@odata.etag"] },
    });
    assert.equal(response.status, 400, entity);
  }
  const terminalRequirement = instance
    .state()
    .entities.msdyn_resourcerequirements.find(
      (record) => record.msdyn_workorder === terminal.msdyn_workorderid,
    );
  const taskType = state.msdyn_servicetasktypes[0];
  const product = state.products.find((record) => record.producttypecode === 1);
  const service = state.products.find((record) => record.producttypecode === 3);
  const unit = state.uoms[0];
  const incidentType = state.msdyn_incidenttypes[0];
  const resource = state.bookableresources[0];
  const bookingStatus = state.bookingstatuses.find(
    (record) => record.msdyn_fieldservicestatus === 690970000,
  );
  const createVectors = {
    msdyn_resourcerequirements: {
      msdyn_name: "Forbidden requirement",
      msdyn_workorder: terminal.msdyn_workorderid,
      msdyn_fromdate: terminalRequirement.msdyn_fromdate,
      msdyn_todate: terminalRequirement.msdyn_todate,
      msdyn_duration: 30,
      msdyn_isprimary: false,
    },
    msdyn_workorderservicetasks: {
      msdyn_name: "Forbidden task",
      msdyn_workorder: terminal.msdyn_workorderid,
      msdyn_tasktype: taskType.msdyn_servicetasktypeid,
    },
    msdyn_workorderproducts: {
      msdyn_name: "Forbidden product",
      msdyn_workorder: terminal.msdyn_workorderid,
      msdyn_product: product.productid,
      msdyn_unit: unit.uomid,
      msdyn_quantity: "1.00",
    },
    msdyn_workorderservices: {
      msdyn_name: "Forbidden service",
      msdyn_workorder: terminal.msdyn_workorderid,
      msdyn_service: service.productid,
      msdyn_duration: 30,
    },
    msdyn_workorderincidents: {
      msdyn_name: "Forbidden incident",
      msdyn_workorder: terminal.msdyn_workorderid,
      msdyn_incidenttype: incidentType.msdyn_incidenttypeid,
    },
    bookableresourcebookings: {
      name: "Forbidden booking",
      resource: resource.bookableresourceid,
      bookingstatus: bookingStatus.bookingstatusid,
      starttime: terminalRequirement.msdyn_fromdate,
      endtime: terminalRequirement.msdyn_todate,
      msdyn_workorder: terminal.msdyn_workorderid,
      msdyn_resourcerequirement:
        terminalRequirement.msdyn_resourcerequirementid,
    },
  };
  for (const [entity, body] of Object.entries(createVectors)) {
    response = await instance.fetch(`/api/data/v9.2/${entity}`, {
      method: "POST",
      body,
    });
    assert.equal(response.status, 400, entity);
  }
  assert.equal(instance.validateIntegrity(), true);
});

test("canonical action bindings generate executable metadata-derived paths", async () => {
  assert.deepEqual(
    Object.fromEntries(
      TENANT_SCHEMA.actions.map((descriptor) => [
        descriptor.name,
        [descriptor.bindingEntitySet, descriptor.outputEntitySet],
      ]),
    ),
    {
      CloseIncident: ["incidents", "incidents"],
      QualifyLead: ["leads", "leads"],
      DisqualifyLead: ["leads", "leads"],
      ReopenLead: ["leads", "leads"],
      WinOpportunity: ["opportunities", "opportunities"],
      LoseOpportunity: ["opportunities", "opportunities"],
      ReopenOpportunity: ["opportunities", "opportunities"],
      GenerateQuote: ["opportunities", "quotes"],
      ActivateQuote: ["quotes", "quotes"],
      ReviseQuote: ["quotes", "quotes"],
      WinQuote: ["quotes", "quotes"],
      CloseQuote: ["quotes", "quotes"],
      ConvertQuoteToSalesOrder: ["quotes", "salesorders"],
      CancelSalesOrder: ["salesorders", "salesorders"],
      FulfillSalesOrder: ["salesorders", "salesorders"],
      ConvertSalesOrderToInvoice: ["salesorders", "invoices"],
      MarkInvoicePaid: ["invoices", "invoices"],
      CancelInvoice: ["invoices", "invoices"],
      CreateWorkOrder: ["incidents", "msdyn_workorders"],
      ScheduleWorkOrder: ["msdyn_workorders", "msdyn_workorders"],
      CompleteBooking: ["bookableresourcebookings", "bookableresourcebookings"],
      CancelBooking: ["bookableresourcebookings", "bookableresourcebookings"],
      DispatchWorkOrder: ["msdyn_workorders", "msdyn_workorders"],
      StartWorkOrder: ["msdyn_workorders", "msdyn_workorders"],
      CompleteWorkOrder: ["msdyn_workorders", "msdyn_workorders"],
      CancelWorkOrder: ["msdyn_workorders", "msdyn_workorders"],
      ReopenWorkOrder: ["msdyn_workorders", "msdyn_workorders"],
    },
  );
  for (const descriptor of TENANT_SCHEMA.actions) {
    const instance = twin();
    const definition = TENANT_SCHEMA.entities[descriptor.bindingEntitySet];
    const target = instance.state().entities[descriptor.bindingEntitySet][0];
    const id = target[definition.key];
    const path = `/api/data/v9.2/${descriptor.bindingEntitySet}(${id})/Microsoft.Dynamics.CRM.${descriptor.name}`;
    const parsed = parsePath(path);
    assert.equal(parsed.action, descriptor.name);
    assert.equal(parsed.entity, descriptor.bindingEntitySet);
    const body = {};
    if (descriptor.name === "ScheduleWorkOrder") {
      const requirement = instance
        .state()
        .entities.msdyn_resourcerequirements.find(
          (record) => record.msdyn_workorder === id,
        );
      body.ResourceId =
        instance.state().entities.bookableresources[0].bookableresourceid;
      body.StartTime = requirement.msdyn_fromdate;
      body.EndTime = requirement.msdyn_todate;
    }
    const response = await instance.fetch(path, { method: "POST", body });
    assert.ok([200, 400].includes(response.status), descriptor.name);
    if (response.status === 400) {
      const message = (await response.json()).error.message;
      assert.doesNotMatch(message, /not registered|must be bound/);
    }
  }

  const instance = twin();
  const opportunity = instance
    .state()
    .entities.opportunities.find((record) => record.statecode === 0);
  const quote = (
    await payload(
      await instance.fetch(
        `/api/data/v9.2/opportunities(${opportunity.opportunityid})/Microsoft.Dynamics.CRM.GenerateQuote`,
        { method: "POST", body: {} },
      ),
    )
  ).primary;
  await payload(
    await instance.fetch(
      `/api/data/v9.2/quotes(${quote.quoteid})/Microsoft.Dynamics.CRM.ActivateQuote`,
      { method: "POST", body: {} },
    ),
  );
  const order = (
    await payload(
      await instance.fetch(
        `/api/data/v9.2/quotes(${quote.quoteid})/Microsoft.Dynamics.CRM.ConvertQuoteToSalesOrder`,
        { method: "POST", body: {} },
      ),
    )
  ).primary;
  const fulfilled = (
    await payload(
      await instance.fetch(
        `/api/data/v9.2/salesorders(${order.salesorderid})/Microsoft.Dynamics.CRM.FulfillSalesOrder`,
        { method: "POST", body: {} },
      ),
    )
  ).primary;
  const invoice = (
    await payload(
      await instance.fetch(
        `/api/data/v9.2/salesorders(${fulfilled.salesorderid})/Microsoft.Dynamics.CRM.ConvertSalesOrderToInvoice`,
        { method: "POST", body: {} },
      ),
    )
  ).primary;
  assert.ok(invoice.invoiceid);
});

test("seed metadata and the complete authoritative envelope reject tampering", () => {
  const vectors = [
    (value) => {
      value.metadata.actions[0].bindingEntitySet = "accounts";
    },
    (value) => {
      value.metadata.apps[0].prefix = "forged";
    },
    (value) => {
      value.metadata.namespace = "Forged";
    },
    (value) => {
      value.metadata.version = "99.0";
    },
    (value) => {
      value.metadata["@odata.context"] = "https://forged.example/$metadata";
    },
    (value) => {
      value.metadata.schemaDigest = "0".repeat(64);
    },
    (value) => {
      value.simulatorPolicies.push("forged");
    },
    (value) => {
      value.schema.actions[0].outputEntitySet = "accounts";
    },
    (value) => {
      value.identity.OrganizationId =
        "00000000-0000-4000-8000-000000000001";
    },
    (value) => {
      value.identities[1].title = "Forged role";
      value.entities.systemusers.find(
        (record) =>
          record.systemuserid === value.identities[1].systemuserid,
      ).title = "Forged role";
    },
    (value) => {
      value.metadata.extra = true;
    },
    (value) => {
      value.fixtureChains[0].extra = true;
    },
    (value) => {
      value.fixtureChains[0].lead =
        "00000000-0000-4000-8000-000000000001";
    },
  ];
  for (const mutate of vectors) {
    const tampered = structuredClone(seed);
    mutate(tampered);
    assert.throws(() => createTwin({ seed: tampered }), /seed|metadata|schema/i);
  }
  const instance = twin();
  return instance.fetch("/api/data/v9.2/$metadata").then(async (response) => {
    const metadata = await payload(response);
    assert.deepEqual(metadata.actions, TENANT_SCHEMA.actions);
    assert.deepEqual(metadata.apps, Object.values(TENANT_SCHEMA.apps));
    assert.equal(metadata.namespace, TENANT_SCHEMA.namespace);
    assert.equal(metadata.schemaDigest, seed.schemaDigest);
  });
});

test("shell declares exactly three business apps and app-prefixed routes", () => {
  const html = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  const appSource = fs.readFileSync(new URL("../site/app.mjs", import.meta.url), "utf8");
  for (const route of ["#/cs/dashboard", "#/sales/dashboard", "#/field/dashboard"]) {
    assert.ok(html.includes(route), route);
  }
  for (const label of ["Customer Service Hub", "Sales Hub", "Field Service"]) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /Independent simulator · synthetic data/);
  assert.ok(appSource.includes("Discard unsaved changes?"));
  assert.ok(appSource.includes("updateAppShell"));
  assert.ok(appSource.includes("domainActionDescriptors"));
  assert.ok(appSource.includes("dashboardIds"));
  assert.equal(appRoute("sales", "quotes/abc"), "#/sales/quotes/abc");
  assert.deepEqual(parseAppRoute("#/field/msdyn_workorders/abc").segments, [
    "msdyn_workorders",
    "abc",
  ]);
  const legacy = parseAppRoute("#/cases/abc?tab=related");
  assert.equal(legacy.appId, "customer-service");
  assert.equal(legacy.prefixed, false);
  assert.equal(legacy.canonical, "#/cs/cases/abc?tab=related");
  const pipeline = dashboardComponents(
    seed.entities,
    seed.epoch,
    "sales-pipeline",
  );
  const performance = dashboardComponents(
    seed.entities,
    seed.epoch,
    "sales-performance",
  );
  const field = dashboardComponents(
    seed.entities,
    seed.epoch,
    "field-operations",
  );
  assert.deepEqual(pipeline.cards.slice(0, 2), [
    ["Open Opportunities", 7],
    ["Pipeline Value", "$37275.00"],
  ]);
  assert.deepEqual(performance.cards.slice(0, 3), [
    ["Won Revenue", "$50400.00"],
    ["Paid Invoices", 2],
    ["Paid Invoice Value", "$8401.00"],
  ]);
  assert.deepEqual(field.cards, [
    ["Unscheduled", 2],
    ["Scheduled", 3],
    ["In Progress", 3],
    ["Completed", 4],
  ]);
});
