import { TENANT_SCHEMA } from "./tenant-schema.mjs";

export const PAGE_SIZE = 50;
export const RELATED_ACTIVITY_LIMIT = 25;
export const CASE_STATUS_REASON_LABELS = Object.freeze({
  0: Object.freeze({ 1: "In Progress", 2: "On Hold", 3: "Waiting for Details", 4: "Researching" }),
  1: Object.freeze({ 5: "Problem Solved", 1000: "Information Provided" }),
  2: Object.freeze({ 6: "Canceled", 2000: "Merged" }),
});

export const APP_ROUTE_PREFIXES = Object.freeze(
  Object.fromEntries(
    Object.values(TENANT_SCHEMA.apps).map((app) => [app.prefix, app.id]),
  ),
);

export function appRoute(appId, path = "dashboard") {
  const app = TENANT_SCHEMA.apps[appId];
  if (!app) throw new TypeError(`unknown app: ${appId}`);
  return `#/${app.prefix}/${String(path).replace(/^\/+/, "")}`;
}

export function parseAppRoute(hash) {
  const value = String(hash || "").startsWith("#/")
    ? String(hash).slice(2)
    : "dashboard";
  const queryIndex = value.indexOf("?");
  const path = queryIndex >= 0 ? value.slice(0, queryIndex) : value;
  const query = queryIndex >= 0 ? value.slice(queryIndex + 1) : "";
  const rawSegments = path.split("/").filter(Boolean);
  const appId = APP_ROUTE_PREFIXES[rawSegments[0]] || "customer-service";
  const prefixed = Boolean(APP_ROUTE_PREFIXES[rawSegments[0]]);
  const segments = prefixed ? rawSegments.slice(1) : rawSegments;
  return {
    appId,
    prefixed,
    segments,
    key: segments.join("/"),
    query,
    canonical: appRoute(
      appId,
      `${segments.join("/") || "dashboard"}${query ? `?${query}` : ""}`,
    ),
  };
}

export const NAV_GROUPS = Object.freeze([
  Object.freeze({
    label: "My Work",
    items: Object.freeze([
      Object.freeze({ id: "dashboards", label: "Dashboards", route: "#/dashboard" }),
      Object.freeze({ id: "activities", label: "Activities", route: "#/activities" }),
    ]),
  }),
  Object.freeze({
    label: "Customers",
    items: Object.freeze([
      Object.freeze({ id: "accounts", label: "Accounts", route: "#/accounts" }),
      Object.freeze({ id: "contacts", label: "Contacts", route: "#/contacts" }),
    ]),
  }),
  Object.freeze({
    label: "Service",
    items: Object.freeze([
      Object.freeze({ id: "cases", label: "Cases", route: "#/cases" }),
      Object.freeze({ id: "queues", label: "Queues", route: "#/queues" }),
    ]),
  }),
  Object.freeze({
    label: "Knowledge",
    items: Object.freeze([
      Object.freeze({
        id: "knowledge-articles",
        label: "Knowledge Articles",
        route: "#/knowledge-articles",
      }),
      Object.freeze({
        id: "knowledge-search",
        label: "Knowledge Search",
        route: "#/knowledge-search",
      }),
    ]),
  }),
  Object.freeze({
    label: "Service Management",
    items: Object.freeze([
      Object.freeze({
        id: "simulation-settings",
        label: "Simulation settings",
        route: "#/service-management/simulation-settings",
      }),
      Object.freeze({
        id: "api-simulation",
        label: "API & simulation",
        route: "#/service-management/api-simulation",
      }),
    ]),
  }),
]);

const LEGACY_ENTITY_UI = Object.freeze({
  accounts: Object.freeze({
    singular: "Account",
    plural: "Accounts",
    id: "accountid",
    primary: "name",
    search: Object.freeze([
      "name",
      "accountnumber",
      "telephone1",
      "emailaddress1",
      "address1_city",
      "owneridname",
    ]),
    columns: Object.freeze([
      ["name", "Account Name"],
      ["accountnumber", "Account Number"],
      ["address1_city", "City"],
      ["telephone1", "Main Phone"],
      ["owneridname", "Owner"],
    ]),
  }),
  contacts: Object.freeze({
    singular: "Contact",
    plural: "Contacts",
    id: "contactid",
    primary: "fullname",
    search: Object.freeze([
      "fullname",
      "emailaddress1",
      "telephone1",
      "jobtitle",
      "parentcustomeridname",
      "owneridname",
    ]),
    columns: Object.freeze([
      ["fullname", "Full Name"],
      ["parentcustomeridname", "Company"],
      ["jobtitle", "Job Title"],
      ["emailaddress1", "Email"],
      ["telephone1", "Business Phone"],
    ]),
  }),
  incidents: Object.freeze({
    singular: "Case",
    plural: "Cases",
    id: "incidentid",
    primary: "title",
    search: Object.freeze([
      "title",
      "ticketnumber",
      "customeridname",
      "primarycontactidname",
      "owneridname",
    ]),
    columns: Object.freeze([
      ["ticketnumber", "Case Number"],
      ["title", "Case Title"],
      ["customeridname", "Customer"],
      ["prioritycode", "Priority"],
      ["statecode", "Status"],
      ["createdon", "Created On"],
    ]),
  }),
  tasks: Object.freeze({
    singular: "Task",
    plural: "Tasks",
    id: "activityid",
    primary: "subject",
    search: Object.freeze(["subject", "regardingobjectidname", "owneridname"]),
    columns: Object.freeze([
      ["subject", "Subject"],
      ["regardingobjectidname", "Regarding"],
      ["scheduledend", "Due"],
      ["statecode", "Status"],
      ["owneridname", "Owner"],
    ]),
  }),
  emails: Object.freeze({
    singular: "Email",
    plural: "Emails",
    id: "activityid",
    primary: "subject",
    search: Object.freeze([
      "subject",
      "fromname",
      "toname",
      "regardingobjectidname",
      "owneridname",
    ]),
    columns: Object.freeze([
      ["subject", "Subject"],
      ["fromname", "From"],
      ["toname", "To"],
      ["senton", "Date"],
      ["statecode", "Status"],
    ]),
  }),
});

function titleCaseField(name) {
  return name
    .replace(/^msdyn_/, "")
    .replace(/idname$/, "")
    .replace(/id$/, "")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const GENERATED_ENTITY_UI = Object.fromEntries(
  Object.entries(TENANT_SCHEMA.entities).map(([entity, definition]) => {
    const declared = definition.ui || {};
    const columns = declared.columns || [
      [definition.primaryName, titleCaseField(definition.primaryName)],
      ...(definition.fields.statecode ? [["statecode", "Status"]] : []),
      ...(definition.fields.modifiedon ? [["modifiedon", "Modified On"]] : []),
    ];
    const search = declared.search || columns.map(([field]) => field);
    return [
      entity,
      Object.freeze({
        singular: declared.singular || titleCaseField(definition.logicalName),
        plural: declared.plural || titleCaseField(entity),
        id: definition.key,
        primary: definition.primaryName,
        search: Object.freeze(search),
        columns: Object.freeze(columns.map((column) => Object.freeze(column))),
      }),
    ];
  }),
);

export const ENTITY_UI = Object.freeze({
  ...GENERATED_ENTITY_UI,
  ...LEGACY_ENTITY_UI,
});


const LEGACY_FORM_FIELDS = Object.freeze({
  accounts: Object.freeze({
    summary: Object.freeze([
      ["name", "Account Name", "text", true],
      ["accountnumber", "Account Number", "text", false],
      ["telephone1", "Main Phone", "tel", false],
      ["emailaddress1", "Email", "email", false],
      ["websiteurl", "Website", "url", false],
      ["industrycode", "Industry", "text", false],
    ]),
    details: Object.freeze([
      ["address1_line1", "Street", "text", false],
      ["address1_city", "City", "text", false],
      ["address1_stateorprovince", "State / Province", "text", false],
      ["address1_postalcode", "Postal Code", "text", false],
      ["address1_country", "Country", "text", false],
      ["description", "Description", "textarea", false],
      ["primarycontactidname", "Primary Contact", "text", false],
      ["owneridname", "Owner", "text", false],
      ["createdon", "Created On", "datetime", false],
      ["modifiedon", "Modified On", "datetime", false],
    ]),
  }),
  contacts: Object.freeze({
    summary: Object.freeze([
      ["firstname", "First Name", "text", true],
      ["lastname", "Last Name", "text", true],
      ["jobtitle", "Job Title", "text", false],
      ["emailaddress1", "Email", "email", false],
      ["telephone1", "Business Phone", "tel", false],
    ]),
    details: Object.freeze([
      ["parentcustomeridname", "Company", "text", false],
      ["address1_city", "City", "text", false],
      ["address1_stateorprovince", "State / Province", "text", false],
      ["preferredcontactmethodcode", "Preferred Contact Method", "number", false],
      ["owneridname", "Owner", "text", false],
      ["createdon", "Created On", "datetime", false],
      ["modifiedon", "Modified On", "datetime", false],
    ]),
  }),
  incidents: Object.freeze({
    summary: Object.freeze([
      ["title", "Case Title", "text", true],
      ["description", "Description", "textarea", false],
      ["prioritycode", "Priority", "number", false],
      ["caseorigincode", "Origin", "number", false],
      ["casetypecode", "Case Type", "number", false],
      ["resolveby", "Resolve By", "datetime", false],
    ]),
    details: Object.freeze([
      ["ticketnumber", "Case Number", "text", false],
      ["customeridname", "Customer", "text", false],
      ["primarycontactidname", "Primary Contact", "text", false],
      ["owneridname", "Owner", "text", false],
      ["createdon", "Created On", "datetime", false],
      ["modifiedon", "Modified On", "datetime", false],
    ]),
  }),
  tasks: Object.freeze({
    summary: Object.freeze([
      ["subject", "Subject", "text", true],
      ["description", "Description", "textarea", false],
      ["scheduledend", "Due", "datetime", true],
      ["prioritycode", "Priority", "number", false],
    ]),
    details: Object.freeze([
      ["regardingobjectidname", "Regarding", "text", false],
      ["owneridname", "Owner", "text", false],
      ["percentcomplete", "Percent Complete", "number", false],
      ["actualend", "Completed On", "datetime", false],
    ]),
  }),
  emails: Object.freeze({
    summary: Object.freeze([
      ["subject", "Subject", "text", true],
      ["fromaddress", "From", "email", true],
      ["toaddress", "To", "email", true],
      ["description", "Message", "textarea", false],
    ]),
    details: Object.freeze([
      ["regardingobjectidname", "Regarding", "text", false],
      ["senton", "Sent / Received", "datetime", false],
      ["owneridname", "Owner", "text", false],
    ]),
  }),
});

function formKind(field) {
  if (field.runtimeType === "datetime") return "datetime";
  if (field.runtimeType === "integer") return "number";
  if (field.runtimeType === "url") return "url";
  return field.name?.includes("description") || field.name?.includes("instructions")
    ? "textarea"
    : "text";
}

const GENERATED_FORM_FIELDS = Object.fromEntries(
  Object.entries(TENANT_SCHEMA.entities).map(([entity, definition]) => {
    const requested = definition.ui?.form || [definition.primaryName];
    const fields = requested
      .filter((name) => definition.fields[name] && !definition.fields[name].lookup)
      .map((name) => {
        const field = { ...definition.fields[name], name };
        return Object.freeze([
          name,
          titleCaseField(name),
          formKind(field),
          definition.requiredOnCreate.includes(name),
        ]);
      });
    const midpoint = Math.min(6, fields.length);
    return [
      entity,
      Object.freeze({
        summary: Object.freeze(fields.slice(0, midpoint)),
        details: Object.freeze(fields.slice(midpoint)),
      }),
    ];
  }),
);

export const FORM_FIELDS = Object.freeze({
  ...GENERATED_FORM_FIELDS,
  ...LEGACY_FORM_FIELDS,
});


const LEGACY_FORM_LOOKUPS = Object.freeze({
  accounts: Object.freeze([
    Object.freeze({
      field: "primarycontactid",
      label: "Primary Contact",
      entity: "contacts",
      idField: "contactid",
      textField: "fullname",
      required: false,
    }),
  ]),
  contacts: Object.freeze([
    Object.freeze({
      field: "parentcustomerid",
      label: "Account",
      entity: "accounts",
      idField: "accountid",
      textField: "name",
      required: true,
    }),
  ]),
  incidents: Object.freeze([
    Object.freeze({
      field: "customerid",
      label: "Customer Account",
      entity: "accounts",
      idField: "accountid",
      textField: "name",
      required: true,
      typeField: "customeridtype",
      typeValue: "accounts",
    }),
    Object.freeze({
      field: "primarycontactid",
      label: "Primary Contact",
      entity: "contacts",
      idField: "contactid",
      textField: "fullname",
      required: true,
      activeOnly: true,
    }),
  ]),
});

const GENERATED_FORM_LOOKUPS = Object.fromEntries(
  Object.entries(TENANT_SCHEMA.entities).map(([entity, definition]) => [
    entity,
    Object.freeze(
      (definition.ui?.form || [])
        .filter((name) => definition.fields[name]?.lookup)
        .map((name) => {
          const field = definition.fields[name];
          const targets = field.lookup.targets.map((target) => {
            const targetDefinition = TENANT_SCHEMA.entities[target];
            return Object.freeze({
              entity: target,
              idField: targetDefinition.key,
              textField: targetDefinition.primaryName,
            });
          });
          const target = targets[0];
          return Object.freeze({
            field: name,
            label: titleCaseField(name),
            entity: target.entity,
            idField: target.idField,
            textField: target.textField,
            targets: Object.freeze(targets),
            required: definition.requiredOnCreate.includes(name),
            activeOnly:
              targets.length === 1 &&
              TENANT_SCHEMA.entities[target.entity].activeStatusPairs.length > 0,
            typeField: field.lookup.discriminator || null,
            typeValue: field.lookup.discriminator ? target.entity : null,
          });
        }),
    ),
  ]),
);

export const FORM_LOOKUPS = Object.freeze({
  ...GENERATED_FORM_LOOKUPS,
  ...LEGACY_FORM_LOOKUPS,
});


const LEGACY_SYSTEM_VIEWS = Object.freeze({
  accounts: Object.freeze([
    Object.freeze({ id: "active", label: "Active Accounts" }),
    Object.freeze({ id: "all", label: "All Accounts" }),
  ]),
  contacts: Object.freeze([
    Object.freeze({ id: "active", label: "Active Contacts" }),
    Object.freeze({ id: "inactive", label: "Inactive Contacts" }),
    Object.freeze({ id: "all", label: "All Contacts" }),
  ]),
  incidents: Object.freeze([
    Object.freeze({ id: "active", label: "Active Cases" }),
    Object.freeze({ id: "high-priority", label: "High Priority Cases" }),
    Object.freeze({ id: "resolved", label: "Resolved Cases" }),
    Object.freeze({ id: "canceled", label: "Canceled Cases" }),
    Object.freeze({ id: "all", label: "All Cases" }),
  ]),
  tasks: Object.freeze([
    Object.freeze({ id: "open", label: "Open Tasks" }),
    Object.freeze({ id: "overdue", label: "Overdue Tasks" }),
    Object.freeze({ id: "completed", label: "Completed Tasks" }),
    Object.freeze({ id: "canceled", label: "Canceled Tasks" }),
    Object.freeze({ id: "all", label: "All Tasks" }),
  ]),
  emails: Object.freeze([
    Object.freeze({ id: "all", label: "All Emails" }),
    Object.freeze({ id: "sent", label: "Sent Email" }),
    Object.freeze({ id: "received", label: "Received Email" }),
  ]),
  activities: Object.freeze([
    Object.freeze({ id: "all", label: "All Activities" }),
    Object.freeze({ id: "open", label: "Open Activities" }),
    Object.freeze({ id: "overdue", label: "Overdue Activities" }),
    Object.freeze({ id: "completed", label: "Completed Activities" }),
  ]),
});

const GENERATED_SYSTEM_VIEWS = Object.fromEntries(
  Object.keys(TENANT_SCHEMA.entities).map((entity) => [
    entity,
    Object.freeze([
      ...(TENANT_SCHEMA.entities[entity].activeStatusPairs.length
        ? [Object.freeze({ id: "active", label: `Active ${ENTITY_UI[entity].plural}` })]
        : []),
      Object.freeze({ id: "all", label: `All ${ENTITY_UI[entity].plural}` }),
    ]),
  ]),
);

export const SYSTEM_VIEWS = Object.freeze({
  ...GENERATED_SYSTEM_VIEWS,
  ...LEGACY_SYSTEM_VIEWS,
});


export function codeUnitCompare(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

export function formatUtc(value) {
  if (!value || typeof value !== "string") return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

export function taskStatusLabel(task, now) {
  if (task.statecode === 1) return "Completed";
  if (task.statecode === 2) return "Canceled";
  return isTaskOverdue(task, now) ? "Overdue" : "Open";
}

export function isTaskOverdue(task, now) {
  if (!task || task.statecode !== 0 || !task.scheduledend || !now) return false;
  return Date.parse(task.scheduledend) < Date.parse(now);
}

export function emailStatusLabel(email) {
  return email.directioncode ? "Sent" : "Received";
}

export function caseStatusLabel(record) {
  if (record.statecode === 0) return "Active";
  if (record.statecode === 1) return "Resolved";
  return "Canceled";
}

export function caseStatusReasonLabel(record) {
  return CASE_STATUS_REASON_LABELS[record?.statecode]?.[record?.statuscode] || "Unknown";
}

export function contactStatusLabel(value) {
  return Number(value) === 0 ? "Active" : "Inactive";
}

export function priorityLabel(value) {
  return ({ 1: "High", 2: "Normal", 3: "Low" })[Number(value)] || "—";
}

export function gridCodeLabel(entity, field, value, now = "", record = null) {
  const formatted =
    record?.[`${field}@OData.Community.Display.V1.FormattedValue`];
  if (formatted) return formatted;
  if (field === "prioritycode") return priorityLabel(value);
  if (entity === "incidents" && field === "statuscode") {
    return caseStatusReasonLabel(record || { statuscode: value });
  }
  if (field === "statecode") {
    if (entity === "incidents") return caseStatusLabel(record || { statecode: value });
    if (entity === "tasks") return taskStatusLabel(record || { statecode: value }, now);
    if (entity === "emails") return emailStatusLabel(record || { directioncode: false });
    if (entity === "contacts" || entity === "accounts") return contactStatusLabel(value);
  }
  if (field === "directioncode") return value ? "Sent" : "Received";
  if (
    field.endsWith("on") ||
    field === "scheduledend" ||
    field === "scheduledstart" ||
    field === "resolveby"
  ) {
    return formatUtc(value);
  }
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function combineActivities(emails = [], tasks = [], now = "") {
  const emailRows = emails.map((record) => ({
    activityid: record.activityid,
    activitytype: "Email",
    entity: "emails",
    subject: record.subject,
    regardingobjectidname: record.regardingobjectidname,
    owneridname: record.owneridname,
    activitydate: record.senton || record.modifiedon,
    statuslabel: emailStatusLabel(record),
    state: record.directioncode ? "completed" : "completed",
    record,
  }));
  const taskRows = tasks.map((record) => {
    const label = taskStatusLabel(record, now);
    return {
      activityid: record.activityid,
      activitytype: "Task",
      entity: "tasks",
      subject: record.subject,
      regardingobjectidname: record.regardingobjectidname,
      owneridname: record.owneridname,
      activitydate: record.scheduledend,
      statuslabel: label,
      state:
        label === "Open" || label === "Overdue"
          ? label.toLowerCase()
          : label === "Canceled"
            ? "canceled"
            : "completed",
      record,
    };
  });
  return [...emailRows, ...taskRows].sort(
    (left, right) =>
      codeUnitCompare(right.activitydate, left.activitydate) ||
      codeUnitCompare(left.activityid, right.activityid),
  );
}

export function isSchemaActive(entity, record) {
  const pairs = TENANT_SCHEMA.entities[entity]?.activeStatusPairs || [];
  return pairs.some(
    (pair) =>
      pair.statecode === record?.statecode &&
      pair.statuscode === record?.statuscode,
  );
}

export function applySystemView(records, entity, viewId, now = "") {
  const rows = records.slice();
  if (viewId === "all") return rows;
  if (entity === "activities") {
    if (viewId === "open") return rows.filter((row) => row.state === "open" || row.state === "overdue");
    if (viewId === "overdue") return rows.filter((row) => row.state === "overdue");
    if (viewId === "completed") return rows.filter((row) => row.state === "completed");
  }
  if (entity === "accounts" || entity === "contacts") {
    if (viewId === "active") return rows.filter((record) => record.statecode === 0);
    if (viewId === "inactive") return rows.filter((record) => record.statecode === 1);
  }
  if (entity === "incidents") {
    if (viewId === "active") return rows.filter((record) => record.statecode === 0);
    if (viewId === "resolved") return rows.filter((record) => record.statecode === 1);
    if (viewId === "canceled") return rows.filter((record) => record.statecode === 2);
    if (viewId === "high-priority") {
      return rows.filter((record) => record.statecode === 0 && record.prioritycode === 1);
    }
  }
  if (entity === "tasks") {
    if (viewId === "open") return rows.filter((record) => record.statecode === 0);
    if (viewId === "overdue") return rows.filter((record) => isTaskOverdue(record, now));
    if (viewId === "completed") return rows.filter((record) => record.statecode === 1);
    if (viewId === "canceled") return rows.filter((record) => record.statecode === 2);
  }
  if (entity === "emails") {
    if (viewId === "sent") return rows.filter((record) => record.directioncode);
    if (viewId === "received") return rows.filter((record) => !record.directioncode);
  }
  if (
    viewId === "active" &&
    TENANT_SCHEMA.entities[entity]?.activeStatusPairs?.length
  ) {
    return rows.filter((record) => isSchemaActive(entity, record));
  }
  if (
    viewId === "inactive" &&
    TENANT_SCHEMA.entities[entity]?.activeStatusPairs?.length
  ) {
    return rows.filter((record) => !isSchemaActive(entity, record));
  }
  return rows;
}

export function searchRows(records, fields, query, displayValue = null) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return records.slice();
  return records.filter((record) =>
    fields.some((field) => {
      const raw = record[field];
      const displayed = displayValue ? displayValue(record, field, raw) : raw;
      return [raw, displayed].some((value) => String(value ?? "").toLowerCase().includes(needle));
    }),
  );
}

export function stableSortRows(records, key, direction = "asc", identityKey = null) {
  const multiplier = direction === "desc" ? -1 : 1;
  return records.slice().sort((left, right) => {
    const a = left[key];
    const b = right[key];
    let comparison = 0;
    if (a === null || a === undefined) comparison = b === null || b === undefined ? 0 : -1;
    else if (b === null || b === undefined) comparison = 1;
    else if (typeof a === "number" && typeof b === "number") comparison = a - b;
    else if (
      typeof a === "string" &&
      typeof b === "string" &&
      /^-?\d+\.\d+$/.test(a) &&
      /^-?\d+\.\d+$/.test(b)
    ) {
      const scale = Math.max(a.split(".")[1].length, b.split(".")[1].length);
      const units = (value) => {
        const negative = value.startsWith("-");
        const unsigned = negative ? value.slice(1) : value;
        const [whole, fraction] = unsigned.split(".");
        const parsed = BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
        return negative ? -parsed : parsed;
      };
      const difference = units(a) - units(b);
      comparison = difference < 0n ? -1 : difference > 0n ? 1 : 0;
    }
    else comparison = codeUnitCompare(a, b);
    if (comparison) return comparison * multiplier;
    const fallback =
      identityKey ||
      ["accountid", "contactid", "incidentid", "activityid", "connectionid"].find(
        (field) => left[field] !== undefined,
      );
    return fallback ? codeUnitCompare(left[fallback], right[fallback]) : 0;
  });
}

export function paginateRows(records, requestedPage, pageSize = PAGE_SIZE) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new TypeError("page size must be positive");
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const page = Math.min(Math.max(Number(requestedPage) || 1, 1), pageCount);
  const start = (page - 1) * pageSize;
  return {
    page,
    pageCount,
    pageSize,
    total: records.length,
    start: records.length ? start + 1 : 0,
    end: Math.min(start + pageSize, records.length),
    records: records.slice(start, start + pageSize),
  };
}

export function updateSelection(currentSelection, keys, selected) {
  const next = new Set(currentSelection || []);
  for (const key of keys) {
    if (selected) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function newestRelatedEmails(emails, limit = null) {
  const sorted = emails
    .filter((record) => Number.isFinite(Date.parse(record.senton || record.modifiedon || "")))
    .sort(
      (left, right) =>
        codeUnitCompare(right.senton || right.modifiedon, left.senton || left.modifiedon) ||
        codeUnitCompare(left.activityid, right.activityid),
    );
  if (limit === null) return sorted;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError("related email limit must be a non-negative safe integer");
  }
  return sorted.slice(0, limit);
}

export function emailReferencesAccount(email, accountId, incidents = [], contacts = []) {
  const contactIds = new Set(
    contacts.filter((contact) => contact.parentcustomerid === accountId).map((contact) => contact.contactid),
  );
  const incidentIds = new Set(
    incidents
      .filter(
        (incident) =>
          (incident.customeridtype === "accounts" && incident.customerid === accountId) ||
          contactIds.has(incident.primarycontactid) ||
          contactIds.has(incident.customerid),
      )
      .map((incident) => incident.incidentid),
  );
  return (
    (email.regardingobjectidtype === "accounts" && email.regardingobjectid === accountId) ||
    incidentIds.has(email.regardingobjectid) ||
    contactIds.has(email.senderid) ||
    contactIds.has(email.recipientid)
  );
}

export function relatedEmailsForAccount(
  emails,
  accountId,
  incidents = [],
  contacts = [],
) {
  return newestRelatedEmails(
    emails.filter((email) => emailReferencesAccount(email, accountId, incidents, contacts)),
  );
}

export function relatedEmailsForContact(emails, contact, incidents = []) {
  const caseIds = new Set(
    incidents
      .filter(
        (incident) =>
          incident.primarycontactid === contact.contactid ||
          (incident.customeridtype === "contacts" && incident.customerid === contact.contactid),
      )
      .map((incident) => incident.incidentid),
  );
  return newestRelatedEmails(
    emails.filter(
      (email) =>
        email.senderid === contact.contactid ||
        email.recipientid === contact.contactid ||
        (email.regardingobjectidtype === "contacts" &&
          email.regardingobjectid === contact.contactid) ||
        caseIds.has(email.regardingobjectid),
    ),
  );
}

export function relatedActivities(entity, record, data, now) {
  const regardingTargets =
    TENANT_SCHEMA.entities.tasks.fields.regardingobjectid.lookup.targets;
  if (!regardingTargets.includes(entity)) return [];
  const references = new Set();
  const addReference = (targetEntity, targetRecord) => {
    const definition = TENANT_SCHEMA.entities[targetEntity];
    const id = targetRecord?.[definition?.key];
    if (id) references.add(`${targetEntity}\0${id}`);
  };
  addReference(entity, record);
  for (let depth = 0; depth < 2; depth += 1) {
    const snapshot = new Set(references);
    for (const targetEntity of regardingTargets) {
      const definition = TENANT_SCHEMA.entities[targetEntity];
      for (const candidate of data[targetEntity] || []) {
        const candidateKey = `${targetEntity}\0${candidate[definition.key]}`;
        const candidateKnown = snapshot.has(candidateKey);
        for (const [field, fieldDefinition] of Object.entries(definition.fields)) {
          const lookup = fieldDefinition.lookup;
          if (!lookup || candidate[field] === null || candidate[field] === undefined) {
            continue;
          }
          const target = lookup.discriminator
            ? candidate[lookup.discriminator]
            : lookup.targets[0];
          if (!regardingTargets.includes(target)) continue;
          const targetKey = `${target}\0${candidate[field]}`;
          if (candidateKnown) references.add(targetKey);
          if (snapshot.has(targetKey)) references.add(candidateKey);
        }
      }
    }
  }
  const matchesRegarding = (item) =>
    references.has(
      `${item.regardingobjectidtype}\0${item.regardingobjectid}`,
    );
  const directId = record[TENANT_SCHEMA.entities[entity].key];
  const emails = data.emails.filter(
    (item) =>
      matchesRegarding(item) ||
      (["accounts", "contacts"].includes(entity) &&
        (item.senderid === directId || item.recipientid === directId)),
  );
  const tasks = data.tasks.filter(matchesRegarding);
  const uniqueEmails = [...new Map(emails.map((item) => [item.activityid, item])).values()];
  const uniqueTasks = [...new Map(tasks.map((item) => [item.activityid, item])).values()];
  return combineActivities(uniqueEmails, uniqueTasks, now);
}

export function resolveConnectionRows(connections, contacts) {
  const names = new Map(contacts.map((contact) => [contact.contactid, contact.fullname]));
  return connections
    .filter((connection) => names.has(connection.record1id) && names.has(connection.record2id))
    .map((connection) => ({
      connectionid: connection.connectionid,
      connectionpairid: connection.connectionpairid,
      fromid: connection.record1id,
      fromname: names.get(connection.record1id),
      toid: connection.record2id,
      toname: names.get(connection.record2id),
      fromrole: connection.record1roleidname || "Related contact",
      torole: connection.record2roleidname || "Related contact",
      effectivestart: connection.effectivestart,
      record: connection,
    }))
    .sort(
      (left, right) =>
        codeUnitCompare(left.toname, right.toname) ||
        codeUnitCompare(left.connectionid, right.connectionid),
    );
}

export function relatedConnectionsForContact(connections, contactId, contacts) {
  const byPair = new Map();
  for (const connection of connections) {
    if (connection.record1id !== contactId && connection.record2id !== contactId) continue;
    const pairId = connection.connectionpairid || connection.connectionid;
    const current = byPair.get(pairId);
    const facesFromContact = connection.record1id === contactId;
    const currentFacesFromContact = current?.record1id === contactId;
    if (
      !current ||
      (facesFromContact && !currentFacesFromContact) ||
      (
        facesFromContact === currentFacesFromContact &&
        codeUnitCompare(connection.connectionid, current.connectionid) < 0
      )
    ) {
      byPair.set(pairId, connection);
    }
  }
  return resolveConnectionRows(
    [...byPair.values()],
    contacts,
  ).map((row) =>
    row.fromid === contactId
      ? row
      : {
          ...row,
          fromid: row.toid,
          fromname: row.toname,
          toid: row.fromid,
          toname: row.fromname,
          fromrole: row.torole,
          torole: row.fromrole,
        },
  );
}

export function deriveDashboardMetrics(data, now) {
  const activeCases = data.incidents.filter((record) => record.statecode === 0);
  const resolvedCases = data.incidents.filter((record) => record.statecode === 1);
  const openTasks = data.tasks.filter((record) => record.statecode === 0);
  const overdueTasks = openTasks.filter((record) => isTaskOverdue(record, now));
  const policyDeadlineBreaches = activeCases.filter(
    (record) => record.resolveby && Date.parse(record.resolveby) < Date.parse(now),
  );
  const byPriority = [1, 2, 3].map((code) => ({
    code,
    label: priorityLabel(code),
    value: activeCases.filter((record) => record.prioritycode === code).length,
  }));
  const byOrigin = [
    [1, "Phone"],
    [2, "Email"],
    [3, "Web"],
  ].map(([code, label]) => ({
    code,
    label,
    value: data.incidents.filter((record) => record.caseorigincode === code).length,
  }));
  return {
    activeCases: activeCases.length,
    resolvedCases: resolvedCases.length,
    highPriorityCases: activeCases.filter((record) => record.prioritycode === 1).length,
    openTasks: openTasks.length,
    overdueTasks: overdueTasks.length,
    policyDeadlineBreaches: policyDeadlineBreaches.length,
    responseCompliance: data.incidents.length
      ? Math.round(
          (data.incidents.filter(
            (record) =>
              record.firstresponsesenton &&
              Date.parse(record.firstresponsesenton) <= Date.parse(record.resolveby),
          ).length /
            data.incidents.length) *
            100,
        )
      : 0,
    emailCount: data.emails.length,
    sentEmails: data.emails.filter((record) => record.directioncode).length,
    receivedEmails: data.emails.filter((record) => !record.directioncode).length,
    completedTasks: data.tasks.filter((record) => record.statecode === 1).length,
    canceledTasks: data.tasks.filter((record) => record.statecode === 2).length,
    byPriority,
    byOrigin,
  };
}

export function dashboardComponents(data, now, dashboardId = "customer-service") {
  const metrics = deriveDashboardMetrics(data, now);
  const sumMoney = (records, field) => {
    const units = records.reduce((total, record) => {
      const value = String(record[field] ?? "0.00");
      const negative = value.startsWith("-");
      const digits = (negative ? value.slice(1) : value).replace(".", "");
      return total + (negative ? -BigInt(digits) : BigInt(digits));
    }, 0n);
    const absolute = units < 0n ? -units : units;
    const text = absolute.toString().padStart(3, "0");
    return `${units < 0n ? "-" : ""}$${text.slice(0, -2)}.${text.slice(-2)}`;
  };
  if (dashboardId === "sales-pipeline") {
    const open = data.opportunities.filter((record) => record.statecode === 0);
    return {
      id: dashboardId,
      title: "Sales Pipeline",
      cards: [
        ["Open Opportunities", open.length],
        ["Pipeline Value", sumMoney(open, "estimatedvalue")],
        ["Open Leads", data.leads.filter((record) => record.statecode === 0).length],
        ["Active Quotes", data.quotes.filter((record) => record.statecode === 1).length],
      ],
      charts: [
        {
          title: "Pipeline by Stage",
          values: [1, 2, 3, 4].map((stage) => ({
            label: ["Qualify", "Develop", "Propose", "Close"][stage - 1],
            value: open.filter((record) => record.salesstagecode === stage).length,
          })),
        },
        {
          title: "Opportunity Status",
          values: [
            { label: "Open", value: open.length },
            { label: "Won", value: data.opportunities.filter((record) => record.statecode === 1).length },
            { label: "Lost", value: data.opportunities.filter((record) => record.statecode === 2).length },
          ],
        },
      ],
    };
  }
  if (dashboardId === "sales-performance") {
    const paid = data.invoices.filter((record) => record.statecode === 1);
    return {
      id: dashboardId,
      title: "Sales Performance",
      cards: [
        ["Won Revenue", sumMoney(data.opportunities.filter((record) => record.statecode === 1), "actualvalue")],
        ["Paid Invoices", paid.length],
        ["Paid Invoice Value", sumMoney(paid, "totalamount")],
        ["Fulfilled Orders", data.salesorders.filter((record) => record.statecode === 3).length],
      ],
      charts: [
        {
          title: "Document Lifecycle",
          values: [
            { label: "Quotes", value: data.quotes.length },
            { label: "Orders", value: data.salesorders.length },
            { label: "Invoices", value: data.invoices.length },
          ],
        },
      ],
    };
  }
  if (dashboardId === "field-operations") {
    const workorders = data.msdyn_workorders;
    return {
      id: dashboardId,
      title: "Field Service Operations",
      cards: [
        ["Unscheduled", workorders.filter((record) => record.msdyn_systemstatus === 690970000).length],
        ["Scheduled", workorders.filter((record) => record.msdyn_systemstatus === 690970001).length],
        ["In Progress", workorders.filter((record) => record.msdyn_systemstatus === 690970002).length],
        ["Completed", workorders.filter((record) => record.msdyn_systemstatus === 690970003).length],
      ],
      charts: [
        {
          title: "Work Order Status",
          values: [
            ["Unscheduled", 690970000],
            ["Scheduled", 690970001],
            ["In Progress", 690970002],
            ["Completed", 690970003],
            ["Canceled", 690970005],
          ].map(([label, status]) => ({
            label,
            value: workorders.filter((record) => record.msdyn_systemstatus === status).length,
          })),
        },
      ],
    };
  }
  if (dashboardId === "technician-day") {
    const day = String(now).slice(0, 10);
    const bookings = data.bookableresourcebookings.filter((record) =>
      record.starttime.startsWith(day),
    );
    return {
      id: dashboardId,
      title: "Technician Day",
      cards: [
        ["Today's Bookings", bookings.length],
        ["Technicians", data.bookableresources.length],
        ["Completed Bookings", bookings.filter((record) => record.bookingstatusname === "Completed").length],
        ["Customer Assets", data.msdyn_customerassets.length],
      ],
      charts: [
        {
          title: "Bookings by Technician",
          values: data.bookableresources.map((resource) => ({
            label: resource.name,
            value: bookings.filter((booking) => booking.resource === resource.bookableresourceid).length,
          })),
        },
      ],
    };
  }
  if (dashboardId === "service-activity") {
    return {
      id: "service-activity",
      title: "Service Activity Dashboard",
      cards: [
        ["Messages", metrics.emailCount],
        ["Open Tasks", metrics.openTasks],
        ["Completed Tasks", metrics.completedTasks],
        ["Overdue Tasks", metrics.overdueTasks],
      ],
      charts: [
        {
          title: "Email Direction",
          values: [
            { label: "Sent", value: metrics.sentEmails },
            { label: "Received", value: metrics.receivedEmails },
          ],
        },
        {
          title: "Task Outcomes",
          values: [
            { label: "Open", value: metrics.openTasks },
            { label: "Completed", value: metrics.completedTasks },
            { label: "Canceled", value: metrics.canceledTasks },
          ],
        },
      ],
    };
  }
  return {
    id: "customer-service",
    title: "Customer Service Dashboard",
    cards: [
      ["Active Cases", metrics.activeCases],
      ["High Priority", metrics.highPriorityCases],
      ["Policy Deadline Breaches", metrics.policyDeadlineBreaches],
      ["Response Before Policy Deadline", `${metrics.responseCompliance}%`],
    ],
    charts: [
      { title: "Active Cases by Priority", values: metrics.byPriority },
      { title: "Cases by Origin", values: metrics.byOrigin },
    ],
  };
}

export function normalizeEditableSnapshot(values = {}) {
  const normalized = {};
  for (const key of Object.keys(values).sort(codeUnitCompare)) {
    const value = values[key];
    if (value === undefined || value === null) normalized[key] = "";
    else if (typeof value === "boolean" || typeof value === "number") normalized[key] = value;
    else normalized[key] = String(value);
  }
  return normalized;
}

export function lookupTargetsForApp(definition, appId = "customer-service") {
  const targets = definition.targets || [
    {
      entity: definition.entity,
      idField: definition.idField,
      textField: definition.textField,
    },
  ];
  const scoped = targets.filter((target) =>
    TENANT_SCHEMA.entities[target.entity].appScopes.includes(appId),
  );
  return scoped.length ? scoped : targets;
}

export function initializeLookupDraft(
  entity,
  record = null,
  draft = {},
  appId = "customer-service",
) {
  const next = { ...draft };
  for (const definition of FORM_LOOKUPS[entity] || []) {
    next[definition.field] = record?.[definition.field] ?? next[definition.field] ?? "";
    if (definition.typeField) {
      const targets = lookupTargetsForApp(definition, appId);
      const preferred = {
        "customer-service": "incidents",
        sales: "opportunities",
        "field-service": "msdyn_workorders",
      }[appId];
      const fallback =
        targets.find((target) => target.entity === preferred)?.entity ||
        targets[0].entity;
      next[definition.typeField] =
        record?.[definition.typeField] ??
        next[definition.typeField] ??
        fallback;
    }
  }
  return next;
}

export function lookupControlValue(draft, field) {
  const value = draft?.[field];
  return value === null || value === undefined ? "" : String(value);
}

export function lookupPayload(entity, draft, record = null) {
  const payload = {};
  for (const definition of FORM_LOOKUPS[entity] || []) {
    const after = lookupControlValue(draft, definition.field);
    const before = lookupControlValue(record, definition.field);
    if (record && after === before) continue;
    if (after || record) payload[definition.field] = after || null;
    if (definition.typeField && after) {
      payload[definition.typeField] =
        draft?.[definition.typeField] || definition.typeValue;
    }
  }
  return payload;
}

export function createFormPayload(entity, draft = {}) {
  const payload = {};
  for (const section of ["summary", "details"]) {
    for (const [field, , kind] of FORM_FIELDS[entity]?.[section] || []) {
      const schemaField = TENANT_SCHEMA.entities[entity]?.fields[field];
      if (!schemaField?.mutable || schemaField.lookup) continue;
      let value = draft[field];
      if (value === "" || value === null || value === undefined) continue;
      if (kind === "number") value = Number(value);
      payload[field] = value;
    }
  }
  return { ...payload, ...lookupPayload(entity, draft) };
}

export function editableSnapshotsEqual(left, right) {
  return JSON.stringify(normalizeEditableSnapshot(left)) === JSON.stringify(normalizeEditableSnapshot(right));
}

export function isRecordEditable(entity, record, entityEditable = true) {
  if (!entityEditable || !record) return false;
  if (entity === "incidents") return record.statecode === 0;
  if (entity === "tasks") return record.statecode === 0;
  if (entity === "emails") return false;
  return record.statecode === 0;
}

export function recordCommandActions(entity, record, options = {}) {
  const dirty = Boolean(options.dirty);
  const actions = [{ id: "back", label: "Back" }, { id: "refresh", label: "Refresh" }];
  if (isRecordEditable(entity, record, options.entityEditable !== false)) {
    actions.unshift({ id: "save", label: "Save", disabled: !dirty });
  }
  if (entity === "tasks" && record.statecode === 0) {
    actions.push({ id: "complete", label: "Mark Complete" });
    actions.push({ id: "cancel", label: "Cancel" });
  }
  if (entity === "incidents") {
    if (record.statecode === 0) {
      actions.push({ id: "resolve", label: "Resolve Case" });
      actions.push({ id: "cancel", label: "Cancel Case" });
    } else {
      actions.push({ id: "reopen", label: "Reopen Case" });
    }
  }
  if (["accounts", "contacts"].includes(entity)) actions.push({ id: "delete", label: "Delete" });
  return actions;
}

export function transitionPatch(entity, action, now) {
  if (entity === "tasks" && action === "complete") {
    return { statecode: 1, statuscode: 5, percentcomplete: 100, actualend: now };
  }
  if (entity === "tasks" && action === "cancel") {
    return { statecode: 2, statuscode: 6, actualend: now };
  }
  if (entity === "incidents" && action === "resolve") return { statecode: 1, statuscode: 5 };
  if (entity === "incidents" && action === "cancel") return { statecode: 2, statuscode: 6 };
  if (entity === "incidents" && action === "reopen") return { statecode: 0, statuscode: 1 };
  throw new TypeError(`unsupported ${entity} transition: ${action}`);
}

export async function runConfirmedLifecycleAction({
  dirty = false,
  record = null,
  requestConfirmation,
  save,
  transition,
}) {
  if (typeof requestConfirmation !== "function" || typeof transition !== "function") {
    throw new TypeError("lifecycle action requires confirmation and transition callbacks");
  }
  if (dirty && typeof save !== "function") {
    throw new TypeError("dirty lifecycle action requires a save callback");
  }
  const confirmed = await requestConfirmation();
  if (confirmed !== true) {
    return {
      ok: false,
      cancelled: true,
      stage: "confirmation",
      actionRecord: record,
      result: null,
    };
  }
  let actionRecord = record;
  if (dirty) {
    try {
      actionRecord = await save();
    } catch (error) {
      return {
        ok: false,
        cancelled: false,
        stage: "save",
        actionRecord: null,
        result: null,
        error,
      };
    }
    if (!actionRecord) {
      return {
        ok: false,
        cancelled: false,
        stage: "save",
        actionRecord: null,
        result: null,
      };
    }
  }
  let result;
  try {
    result = await transition(actionRecord);
  } catch (error) {
    return {
      ok: false,
      cancelled: false,
      stage: "transition",
      actionRecord,
      result: null,
      error,
    };
  }
  if (!result?.ok) {
    return {
      ok: false,
      cancelled: false,
      stage: "transition",
      actionRecord,
      result,
    };
  }
  return {
    ok: true,
    cancelled: false,
    stage: "complete",
    actionRecord,
    result,
  };
}

export function nextRovingTabIndex(tabs, currentIndex, key) {
  const enabled = tabs
    .map((tab, index) => ({ tab, index }))
    .filter(({ tab }) => !tab.disabled)
    .map(({ index }) => index);
  if (!enabled.length) return -1;
  const position = Math.max(enabled.indexOf(currentIndex), 0);
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  if (key === "ArrowRight" || key === "ArrowDown") return enabled[(position + 1) % enabled.length];
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return enabled[(position - 1 + enabled.length) % enabled.length];
  }
  return currentIndex;
}

export function createNavigationHistory(currentIndex = 0) {
  return {
    currentIndex,
    pending: null,
    phase: "idle",
  };
}

export function pushNavigationHistory(history) {
  return { ...history, currentIndex: history.currentIndex + 1, pending: null, phase: "idle" };
}

export function replaceCreatedRecordHistory(currentIndex, route, replaceState) {
  if (!Number.isSafeInteger(currentIndex) || currentIndex < 0) {
    throw new TypeError("history index must be a non-negative safe integer");
  }
  if (typeof route !== "string" || !route.startsWith("#/")) {
    throw new TypeError("replacement route must be an application hash");
  }
  if (typeof replaceState !== "function") {
    throw new TypeError("replaceState must be a function");
  }
  replaceState({ appIndex: currentIndex }, "", route);
  return currentIndex;
}

export function transitionHistoryPop(history, targetIndex, dirty) {
  if (!dirty) return { ...history, currentIndex: targetIndex, pending: null, phase: "idle" };
  return {
    ...history,
    pending: { targetIndex, restoreIndex: history.currentIndex },
    phase: "restore-before-prompt",
  };
}

export function transitionHistoryPrompt(history, proceed) {
  if (!history.pending) return history;
  return proceed
    ? {
        ...history,
        currentIndex: history.pending.targetIndex,
        pending: null,
        phase: "navigate-target",
      }
    : {
        ...history,
        currentIndex: history.pending.restoreIndex,
        pending: null,
        phase: "idle",
      };
}

export function replaceDialogState(activeDialog, incomingDialog) {
  return {
    canceledValue: activeDialog?.cancelValue ?? null,
    next: incomingDialog || null,
  };
}

export function dashboardRenderCompletion(focusTarget = null) {
  return { busy: false, focusTarget: focusTarget || "[data-dashboard-heading]" };
}

export function savedFormRenderTarget(activeForm, savedRecord, selectedTab = "summary") {
  return {
    entity: activeForm.entity,
    id: savedRecord[activeForm.idField],
    etag: savedRecord["@odata.etag"],
    selectedTab,
  };
}

export function captureRouteGuard(navigationToken, route) {
  return { navigationToken, route: String(route) };
}

export function routeGuardMatches(guard, navigationToken, route) {
  return Boolean(
    guard && guard.navigationToken === navigationToken && guard.route === String(route),
  );
}

export function preflightContactDeletion(
  contactIds,
  contacts,
  connections,
  incidents = [],
  emails = [],
  tasks = [],
  accounts = [],
) {
  const selected = new Set(contactIds);
  const blocked = [];
  for (const id of [...selected].sort(codeUnitCompare)) {
    const contact = contacts.find((item) => item.contactid === id);
    if (!contact) continue;
    const references =
      connections.filter(
        (item) =>
          (item.record1type === "contacts" && item.record1id === id) ||
          (item.record2type === "contacts" && item.record2id === id),
      ).length +
      incidents.filter(
        (item) =>
          item.primarycontactid === id ||
          (item.customeridtype === "contacts" && item.customerid === id),
      ).length +
      emails.filter(
        (item) =>
          (item.senderidtype === "contacts" && item.senderid === id) ||
          (item.recipientidtype === "contacts" && item.recipientid === id) ||
          (item.regardingobjectidtype === "contacts" && item.regardingobjectid === id),
      ).length +
      tasks.filter(
        (item) =>
          item.regardingobjectidtype === "contacts" && item.regardingobjectid === id,
      ).length +
      accounts.filter((item) => item.primarycontactid === id).length;
    if (references) blocked.push({ id, name: contact.fullname, references });
  }
  return blocked;
}

export function preflightAccountDeletion(
  accountIds,
  accounts,
  emails = [],
  incidents = [],
  contacts = [],
  tasks = [],
) {
  const selected = new Set(accountIds);
  const blocked = [];
  for (const id of [...selected].sort(codeUnitCompare)) {
    const account = accounts.find((item) => item.accountid === id);
    if (!account) continue;
    const references =
      contacts.filter((item) => item.parentcustomerid === id).length +
      incidents.filter(
        (item) => item.customeridtype === "accounts" && item.customerid === id,
      ).length +
      emails.filter(
        (item) =>
          (item.regardingobjectidtype === "accounts" && item.regardingobjectid === id) ||
          (item.senderidtype === "accounts" && item.senderid === id) ||
          (item.recipientidtype === "accounts" && item.recipientid === id),
      ).length +
      tasks.filter(
        (item) =>
          item.regardingobjectidtype === "accounts" && item.regardingobjectid === id,
      ).length;
    if (references) blocked.push({ id, name: account.name, references });
  }
  return blocked;
}

export function preflightBulkDeletion(entity, recordIds, data) {
  let blocked;
  if (entity === "accounts") {
    blocked = preflightAccountDeletion(
      recordIds,
      data.accounts,
      data.emails,
      data.incidents,
      data.contacts,
      data.tasks,
    );
  } else if (entity === "contacts") {
    blocked = preflightContactDeletion(
      recordIds,
      data.contacts,
      data.connections,
      data.incidents,
      data.emails,
      data.tasks,
      data.accounts,
    );
  } else {
    throw new TypeError("bulk deletion supports accounts and contacts");
  }
  return {
    ok: blocked.length === 0,
    completed: 0,
    blocked,
    message: blocked.length
      ? `0 records deleted. ${blocked.length} selected record(s) have related data.`
      : "",
  };
}

export function shouldInterceptSkipLink(options = {}) {
  return Boolean(
    options.href === "#main-content" &&
      !options.defaultPrevented,
  );
}

export function shouldInterceptSpaNavigation(options = {}) {
  return Boolean(
    options.href?.startsWith("#/") &&
      !options.defaultPrevented &&
      options.button === 0 &&
      !options.metaKey &&
      !options.ctrlKey &&
      !options.shiftKey &&
      !options.altKey &&
      !options.target,
  );
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export async function safeUiRequest(client, input, init = {}, options = {}) {
  const retry = init.retry || options.retry || {
    maxAttempts: 2,
    baseDelayMs: 250,
    maxDelayMs: 2_000,
  };
  let response;
  try {
    response = await client.fetch(input, { ...init, retry });
  } catch (error) {
    return {
      ok: false,
      kind: "transport",
      message: `Request failed: ${error?.message || "transport error"}`,
      error,
    };
  }
  if (
    !response ||
    !Number.isSafeInteger(response.status) ||
    response.status < 100 ||
    response.status > 599 ||
    typeof response.ok !== "boolean" ||
    typeof response.text !== "function"
  ) {
    return {
      ok: false,
      kind: "malformed",
      message: "Request failed: the simulator returned a malformed response.",
      response,
    };
  }
  const httpOk = response.status >= 200 && response.status < 300;
  if (response.ok !== httpOk) {
    return {
      ok: false,
      kind: "malformed",
      message: "Request failed: the simulator returned an inconsistent HTTP response.",
      response,
    };
  }
  let text;
  try {
    text = await response.text();
  } catch {
    return {
      ok: false,
      kind: "malformed",
      message: "Request failed: the simulator response body could not be read.",
      response,
    };
  }
  let data = null;
  const contentType =
    typeof response.headers?.get === "function"
      ? response.headers.get("content-type") || ""
      : "";
  const shouldParse = Boolean(text) && (
    options.expectJson ||
    contentType.toLowerCase().includes("json")
  );
  if (shouldParse) {
    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        kind: "malformed",
        message: "Request failed: the simulator returned malformed JSON.",
        response,
      };
    }
  }
  if (options.expectJson && (!text || data === null || typeof data !== "object")) {
    return {
      ok: false,
      kind: "malformed",
      message: "Request failed: the simulator returned no JSON representation.",
      response,
    };
  }
  if (!httpOk) {
    return {
      ok: false,
      kind: "http",
      status: response.status,
      message: data?.error?.message || `Request failed with HTTP ${response.status}.`,
      response,
      data,
    };
  }
  return { ok: true, kind: "success", status: response.status, response, data, text };
}

export async function safeUiBatch(client, operations, options = {}) {
  const results = [];
  for (const operation of operations) {
    const result = await safeUiRequest(
      client,
      operation.input,
      operation.init,
      operation.options,
    );
    if (!result.ok) {
      return {
        ok: false,
        completed: results.length,
        results,
        failure: result,
        message: result.message,
      };
    }
    results.push(result);
  }
  return { ok: true, completed: results.length, results, message: options.successMessage || "" };
}

export async function safeUiDeleteMany(client, entity, records, data) {
  const config = ENTITY_UI[entity];
  if (!config) throw new TypeError(`unknown UI entity ${entity}`);
  const preflight = preflightBulkDeletion(
    entity,
    records.map((record) => record[config.id]),
    data,
  );
  if (!preflight.ok) return preflight;
  const outcome = await safeUiRequest(
    client,
    `/api/data/v9.2/${entity}`,
    {
      method: "DELETE",
      body: {
        records: records.map((record) => ({
          id: record[config.id],
          etag: record["@odata.etag"],
        })),
      },
    },
    { expectJson: true },
  );
  if (!outcome.ok) {
    return {
      ...outcome,
      completed: 0,
      message: `0 records deleted. ${outcome.message}`,
    };
  }
  if (outcome.data?.deleted !== records.length) {
    return {
      ok: false,
      kind: "malformed",
      completed: 0,
      message: "0 records deleted. The simulator returned an invalid bulk delete result.",
      response: outcome.response,
    };
  }
  return { ...outcome, completed: records.length };
}
