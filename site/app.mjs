import {
  BUILT_IN_SCENARIOS,
  createTwin,
  replayRun,
  runBuiltInScenario,
} from "./twin-core.mjs";
import {
  ENTITY_UI,
  FORM_FIELDS,
  FORM_LOOKUPS,
  NAV_GROUPS,
  PAGE_SIZE,
  SYSTEM_VIEWS,
  appRoute as buildAppRoute,
  applySystemView,
  caseStatusLabel,
  caseStatusReasonLabel,
  codeUnitCompare,
  combineActivities,
  createFormPayload,
  dashboardComponents,
  editableSnapshotsEqual,
  formatUtc,
  gridCodeLabel,
  initializeLookupDraft,
  isRecordEditable,
  lookupTargetsForApp,
  nextRovingTabIndex,
  normalizeEditableSnapshot,
  paginateRows,
  priorityLabel,
  parseAppRoute,
  recordCommandActions,
  relatedActivities,
  relatedConnectionsForContact,
  replaceCreatedRecordHistory,
  runConfirmedLifecycleAction,
  lookupControlValue,
  lookupPayload,
  safeUiBatch,
  safeUiDeleteMany,
  safeUiRequest,
  safeExternalUrl,
  searchRows,
  shouldInterceptSkipLink,
  shouldInterceptSpaNavigation,
  stableSortRows,
  taskStatusLabel,
  transitionPatch,
  updateSelection,
} from "./app-helpers.mjs";
import { TENANT_SCHEMA } from "./tenant-schema.mjs";

const ENTITY_ROUTE = Object.freeze({
  accounts: "accounts",
  contacts: "contacts",
  incidents: "cases",
  tasks: "tasks",
  emails: "emails",
  leads: "leads",
  opportunities: "opportunities",
  opportunityproducts: "opportunityproducts",
  quotes: "quotes",
  quotedetails: "quotedetails",
  salesorders: "salesorders",
  salesorderdetails: "salesorderdetails",
  invoices: "invoices",
  invoicedetails: "invoicedetails",
  products: "products",
  pricelevels: "pricelevels",
  msdyn_workorders: "msdyn_workorders",
  bookableresourcebookings: "bookableresourcebookings",
  msdyn_customerassets: "msdyn_customerassets",
  msdyn_workordertypes: "msdyn_workordertypes",
  msdyn_incidenttypes: "msdyn_incidenttypes",
  msdyn_priorities: "msdyn_priorities",
  msdyn_workorderservicetasks: "msdyn_workorderservicetasks",
  msdyn_workorderproducts: "msdyn_workorderproducts",
  msdyn_resourcerequirements: "msdyn_resourcerequirements",
});
const ROUTE_ENTITY = Object.freeze({
  accounts: "accounts",
  contacts: "contacts",
  cases: "incidents",
  tasks: "tasks",
  emails: "emails",
  leads: "leads",
  opportunities: "opportunities",
  opportunityproducts: "opportunityproducts",
  quotes: "quotes",
  quotedetails: "quotedetails",
  salesorders: "salesorders",
  salesorderdetails: "salesorderdetails",
  invoices: "invoices",
  invoicedetails: "invoicedetails",
  products: "products",
  pricelevels: "pricelevels",
  msdyn_workorders: "msdyn_workorders",
  bookableresourcebookings: "bookableresourcebookings",
  msdyn_customerassets: "msdyn_customerassets",
  msdyn_workordertypes: "msdyn_workordertypes",
  msdyn_incidenttypes: "msdyn_incidenttypes",
  msdyn_priorities: "msdyn_priorities",
  msdyn_workorderservicetasks: "msdyn_workorderservicetasks",
  msdyn_workorderproducts: "msdyn_workorderproducts",
  msdyn_resourcerequirements: "msdyn_resourcerequirements",
});
const FORM_READ_ONLY = new Set([
  "ticketnumber",
  "parentcustomeridname",
  "primarycontactidname",
  "statuscode",
  "customeridname",
  "primarycontactidname",
  "owneridname",
  "createdon",
  "modifiedon",
  "regardingobjectidname",
  "actualend",
]);
const ICON_PATHS = Object.freeze({
  add: ["M12 5v14M5 12h14"],
  back: ["m14 6-6 6 6 6"],
  cancel: ["m6 6 12 12M18 6 6 18"],
  check: ["m5 12 4 4L19 6"],
  chevronLeft: ["m14 6-6 6 6 6"],
  chevronRight: ["m10 6 6 6-6 6"],
  delete: ["M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"],
  download: ["M12 4v11m0 0-4-4m4 4 4-4M5 19h14"],
  edit: ["m5 17 1-4L15 4l4 4-9 9-5 1z"],
  refresh: ["M19 8a7 7 0 1 0 0 8M19 4v4h-4"],
  save: ["M5 4h12l2 2v14H5zM8 4v6h8V4M8 15h8v5"],
  search: ["M10.5 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11m4.5 10 4 4"],
  settings: ["M5 6h14M8 6v5M5 12h14M16 12v5M5 18h14"],
  warning: ["M12 4 3 20h18zM12 9v5M12 17h.01"],
});

const dom = {
  commandBar: document.querySelector("#command-bar"),
  viewRoot: document.querySelector("#view-root"),
  sitemap: document.querySelector("#sitemap"),
  scrim: document.querySelector("#sitemap-scrim"),
  navigationToggle: document.querySelector("#navigation-toggle"),
  navigationClose: document.querySelector("#navigation-close"),
  appLauncher: document.querySelector("#app-launcher"),
  appSelector: document.querySelector("#app-selector"),
  appMenu: document.querySelector("#app-launcher-menu"),
  quickCreate: document.querySelector("#quick-create"),
  quickMenu: document.querySelector("#quick-create-menu"),
  globalSearch: document.querySelector("#global-search"),
  globalSearchInput: document.querySelector("#global-search-input"),
  dialog: document.querySelector("#app-dialog"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogContent: document.querySelector("#dialog-content"),
  dialogActions: document.querySelector("#dialog-actions"),
  dialogClose: document.querySelector("#dialog-close"),
  toastRegion: document.querySelector("#toast-region"),
  errorRegion: document.querySelector("#error-region"),
  mainContent: document.querySelector("#main-content"),
};

const app = {
  seed: null,
  twin: null,
  data: null,
  navigationToken: 0,
  route: null,
  activeForm: null,
  gridStates: new Map(),
  currentApp: "customer-service",
  dashboardIds: new Map([
    ["customer-service", "customer-service"],
    ["sales", "sales-pipeline"],
    ["field-service", "field-operations"],
  ]),
  historyIndex: 0,
  historyRestoring: false,
  historyNavigating: false,
  pendingPop: null,
  dialogResolve: null,
  dialogCancelValue: "cancel",
};

function svgIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const geometry of ICON_PATHS[name] || ICON_PATHS.settings) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", geometry);
    svg.append(path);
  }
  return svg;
}

function appendChildren(node, children) {
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.id) node.id = options.id;
  if (options.type) node.setAttribute("type", options.type);
  for (const [name, value] of Object.entries(options.attributes || {})) {
    if (value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  for (const [name, value] of Object.entries(options.dataset || {})) {
    node.dataset[name] = String(value);
  }
  for (const [name, handler] of Object.entries(options.on || {})) {
    node.addEventListener(name, handler);
  }
  return appendChildren(node, children);
}

function commandButton(label, iconName, handler, options = {}) {
  const button = element(
    "button",
    {
      className: `command-button${options.danger ? " danger" : ""}`,
      type: "button",
      attributes: {
        disabled: options.disabled ? "" : null,
        "aria-label": options.ariaLabel || label,
      },
      on: { click: handler },
    },
    [svgIcon(iconName), element("span", { text: label })],
  );
  return button;
}

function setCommands(commands = []) {
  dom.commandBar.replaceChildren();
  commands.forEach((command, index) => {
    if (command === "separator") {
      dom.commandBar.append(element("span", { className: "command-separator" }));
    } else {
      dom.commandBar.append(command);
    }
    if (index === commands.length - 1) return;
  });
}

function pageHeading(title, subtitle = "", kicker = "", trailing = null) {
  const copy = element("div");
  if (kicker) copy.append(element("span", { className: "heading-kicker", text: kicker }));
  copy.append(element("h1", { text: title, attributes: { tabindex: "-1" } }));
  if (subtitle) copy.append(element("p", { text: subtitle }));
  return element("header", { className: "page-heading" }, [copy, trailing]);
}

function closeNavigation() {
  dom.sitemap.classList.remove("open");
  dom.scrim.classList.remove("open");
  dom.navigationToggle.setAttribute("aria-expanded", "false");
}

function openNavigation() {
  dom.sitemap.classList.add("open");
  dom.scrim.classList.add("open");
  dom.navigationToggle.setAttribute("aria-expanded", "true");
  dom.navigationClose.focus();
}

function closeFlyouts(except = null) {
  for (const [menu, trigger] of [
    [dom.appMenu, dom.appLauncher],
    [dom.quickMenu, dom.quickCreate],
  ]) {
    if (menu === except) continue;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
  if (except !== dom.appMenu) dom.appSelector.setAttribute("aria-expanded", "false");
}

function toggleFlyout(menu, ...triggers) {
  const opening = menu.hidden;
  closeFlyouts(opening ? menu : null);
  menu.hidden = !opening;
  for (const trigger of triggers) trigger.setAttribute("aria-expanded", String(opening));
  if (opening) menu.querySelector("a, button")?.focus();
}

function showToast(message, kind = "success") {
  const toast = element("div", {
    className: `toast${kind === "error" ? " error" : ""}`,
    text: message,
  });
  dom.toastRegion.replaceChildren(toast);
  if (kind === "error") dom.errorRegion.textContent = message;
}

function showDialog(options) {
  if (dom.dialog.open) {
    dom.dialog.close("replaced");
    app.dialogResolve?.("replaced");
  }
  dom.dialogTitle.textContent = options.title;
  dom.dialogContent.replaceChildren(
    typeof options.content === "string"
      ? element("p", { text: options.content })
      : options.content,
  );
  dom.dialogActions.replaceChildren();
  return new Promise((resolve) => {
    let finished = false;
    const complete = (value) => {
      if (finished) return;
      finished = true;
      app.dialogResolve = null;
      if (dom.dialog.open) dom.dialog.close(String(value ?? "cancel"));
      resolve(value);
    };
    app.dialogResolve = complete;
    app.dialogCancelValue = options.cancelValue ?? "cancel";
    for (const action of options.actions || [{ value: "ok", label: "OK", primary: true }]) {
      dom.dialogActions.append(
        element("button", {
          className: action.danger
            ? "danger-button"
            : action.primary
              ? "primary-button"
              : "secondary-button",
          text: action.label,
          type: "button",
          on: { click: () => complete(action.value) },
        }),
      );
    }
    dom.dialog.showModal();
    dom.dialogActions.querySelector("button")?.focus();
  });
}

function refreshData() {
  app.data = app.twin.state().entities;
}

function currentHash() {
  return window.location.hash.startsWith("#/") ? window.location.hash : "#/cs/dashboard";
}

function parseRoute(hash = currentHash()) {
  const parsed = parseAppRoute(hash);
  return {
    hash,
    segments: parsed.segments,
    appId: parsed.appId,
    prefixed: parsed.prefixed,
    query: new URLSearchParams(parsed.query),
    key: parsed.key,
  };
}

function appHash(path = "dashboard", appId = app.currentApp) {
  return buildAppRoute(appId, path);
}

function updateAppShell(appId) {
  const definition = TENANT_SCHEMA.apps[appId];
  app.currentApp = appId;
  dom.appSelector.querySelector("span").textContent = definition.label;
  dom.sitemap.setAttribute("aria-label", `${definition.label} sitemap`);
  dom.sitemap.querySelector(".mobile-nav-heading strong").textContent = definition.label;
  const navigation = dom.sitemap.querySelector("nav");
  navigation.replaceChildren();
  definition.navigation.forEach((group, groupIndex) => {
    const headingId = `nav-${definition.prefix}-${groupIndex}`;
    const section = element("section", {
      attributes: { "aria-labelledby": headingId },
    });
    section.append(element("h2", { id: headingId, text: group.label }));
    for (const [id, label, route] of group.items) {
      section.append(
        element(
          "a",
          {
            attributes: {
              href: appHash(route, appId),
              "data-nav": id,
            },
          },
          [svgIcon("settings"), element("span", { text: label })],
        ),
      );
    }
    navigation.append(section);
  });
  const areaSwitcher = dom.sitemap.querySelector(".area-switcher");
  areaSwitcher.setAttribute("href", appHash("dashboard", appId));
  areaSwitcher.querySelector("span").textContent = definition.label;
  document.querySelector(".product-name").setAttribute(
    "href",
    appHash("dashboard", appId),
  );
  const quickItems =
    appId === "sales"
      ? [
          ["leads", "Lead"],
          ["opportunities", "Opportunity"],
          ["contacts", "Contact"],
          ["accounts", "Account"],
          ["tasks", "Task"],
        ]
      : [
          ["contacts", "Contact"],
          ["accounts", "Account"],
          ["tasks", "Task"],
          ...(appId === "customer-service" ? [["cases", "Case"]] : []),
        ];
  dom.quickMenu.replaceChildren(element("h2", { text: "Quick Create" }));
  for (const [route, label] of quickItems) {
    dom.quickMenu.append(
      element("a", {
        text: label,
        attributes: { href: appHash(`${route}/new`, appId) },
      }),
    );
  }
  document.title = `Static Dynamics 365 — ${definition.label}`;
}

function formIsDirty() {
  return Boolean(app.activeForm?.dirty);
}

async function requestNavigation(hash, options = {}) {
  if (hash === currentHash() && !options.force) return;
  if (formIsDirty() && !options.skipGuard) {
    const decision = await showDialog({
      title: "Discard unsaved changes?",
      content: "Your edits have not been saved. Leave this record and discard them?",
      actions: [
        { value: "stay", label: "Stay" },
        { value: "leave", label: "Discard and leave", danger: true },
      ],
      cancelValue: "stay",
    });
    if (decision !== "leave") return;
  }
  app.activeForm = null;
  app.historyIndex += 1;
  window.history.pushState({ appIndex: app.historyIndex }, "", hash);
  await renderRoute();
}

async function handlePopState(event) {
  const targetIndex = Number.isSafeInteger(event.state?.appIndex) ? event.state.appIndex : 0;
  if (app.historyRestoring) {
    app.historyRestoring = false;
    app.historyIndex = targetIndex;
    const pending = app.pendingPop;
    if (!pending) return;
    const decision = await showDialog({
      title: "Discard unsaved changes?",
      content: "Your edits have not been saved. Continue through browser history?",
      actions: [
        { value: "stay", label: "Stay" },
        { value: "leave", label: "Discard and continue", danger: true },
      ],
      cancelValue: "stay",
    });
    app.pendingPop = null;
    if (decision === "leave") {
      app.activeForm = null;
      app.historyNavigating = true;
      window.history.go(pending.targetIndex - app.historyIndex);
    }
    return;
  }
  if (app.historyNavigating) {
    app.historyNavigating = false;
    app.historyIndex = targetIndex;
    await renderRoute();
    return;
  }
  if (formIsDirty()) {
    const restoreDelta = app.historyIndex - targetIndex;
    if (restoreDelta !== 0) {
      app.pendingPop = { targetIndex };
      app.historyRestoring = true;
      window.history.go(restoreDelta);
      return;
    }
  }
  app.historyIndex = targetIndex;
  app.activeForm = null;
  await renderRoute();
}

function setActiveNavigation(route) {
  const first = route.segments[0] || "dashboard";
  const legacyKey =
    first === "dashboard"
      ? "dashboards"
      : first === "cases"
        ? "cases"
        : first === "service-management"
          ? route.segments[1]
          : first;
  const configured = TENANT_SCHEMA.apps[route.appId].navigation
    .flatMap((group) => group.items)
    .find((item) => item[2] === first);
  const key = configured?.[0] || legacyKey;
  for (const anchor of dom.sitemap.querySelectorAll("[data-nav]")) {
    if (anchor.dataset.nav === key) anchor.setAttribute("aria-current", "page");
    else anchor.removeAttribute("aria-current");
  }
}

function routeForRecord(entity, id) {
  return appHash(`${ENTITY_ROUTE[entity]}/${id}`);
}

function ensureGridState(key, entity) {
  const appKey = `${app.currentApp}:${key}`;
  if (!app.gridStates.has(appKey)) {
    const defaultView =
      entity === "activities"
        ? "all"
        : SYSTEM_VIEWS[entity]?.[0]?.id || "all";
    const config = ENTITY_UI[entity];
    app.gridStates.set(appKey, {
      view: defaultView,
      query: "",
      sortKey: entity === "activities" ? "activitydate" : config?.primary || "createdon",
      sortDirection: entity === "activities" ? "desc" : "asc",
      page: 1,
      selection: new Set(),
    });
  }
  return app.gridStates.get(appKey);
}

function badge(value) {
  return element("span", {
    className: `badge ${String(value).toLowerCase().replaceAll(" ", "-")}`,
    text: value,
  });
}

function displayCell(entity, field, value, record) {
  const shown = gridCodeLabel(entity, field, value, app.twin.clock.now(), record);
  const lookup = Object.entries(TENANT_SCHEMA.entities[entity]?.fields || {}).find(
    ([, definition]) => definition.lookup?.displayField === field,
  );
  if (lookup) {
    const [lookupField, definition] = lookup;
    const target = definition.lookup.discriminator
      ? record[definition.lookup.discriminator]
      : definition.lookup.targets[0];
    if (record[lookupField] && ENTITY_ROUTE[target]) {
      return element("a", {
        text: shown,
        attributes: { href: routeForRecord(target, record[lookupField]) },
      });
    }
  }
  if (
    field === "statecode" ||
    field === "prioritycode" ||
    (entity === "activities" && field === "statuslabel")
  ) {
    return badge(shown);
  }
  return document.createTextNode(shown);
}

function gridColumns(entity) {
  if (entity === "activities") {
    return [
      ["activitytype", "Activity Type"],
      ["subject", "Subject"],
      ["regardingobjectidname", "Regarding"],
      ["activitydate", "Due / Date"],
      ["statuslabel", "Status"],
      ["owneridname", "Owner"],
    ];
  }
  return ENTITY_UI[entity].columns;
}

function gridIdentity(entity, record) {
  return entity === "activities" ? record.activityid : record[ENTITY_UI[entity].id];
}

function renderGrid(entity, records, title, subtitle = "") {
  const key = entity;
  const state = ensureGridState(key, entity);
  const config = ENTITY_UI[entity];
  const columns = gridColumns(entity);
  const searchFields =
    entity === "activities"
      ? ["activitytype", "subject", "regardingobjectidname", "statuslabel", "owneridname"]
      : config.search;
  let visible = applySystemView(records, entity, state.view, app.twin.clock.now());
  visible = searchRows(visible, searchFields, state.query, (record, field, value) =>
    entity === "activities"
      ? value
      : gridCodeLabel(entity, field, value, app.twin.clock.now(), record),
  );
  visible = stableSortRows(
    visible,
    state.sortKey,
    state.sortDirection,
    entity === "activities" ? "activityid" : config.id,
  );
  const page = paginateRows(visible, state.page, PAGE_SIZE);
  state.page = page.page;
  const pageIds = page.records.map((record) => gridIdentity(entity, record));
  const selectedOnPage = pageIds.filter((id) => state.selection.has(id));

  const select = element("select", {
    attributes: { "aria-label": `${title} system view` },
    on: {
      change: (event) => {
        state.view = event.target.value;
        state.page = 1;
        state.selection = new Set();
        renderGridRoute(entity);
      },
    },
  });
  for (const view of SYSTEM_VIEWS[entity] || [{ id: "all", label: `All ${title}` }]) {
    const option = element("option", { text: view.label, attributes: { value: view.id } });
    if (view.id === state.view) option.selected = true;
    select.append(option);
  }
  const search = element("input", {
    className: "view-search",
    attributes: {
      type: "search",
      value: state.query,
      placeholder: `Search ${title.toLowerCase()}`,
      "aria-label": `Search ${title}`,
    },
    on: {
      input: (event) => {
        state.query = event.target.value;
        state.page = 1;
        renderGridRoute(entity, { preserveFocus: true });
      },
    },
  });
  const toolbar = element("div", { className: "view-toolbar" }, [
    element("label", { text: "View" }),
    select,
    search,
  ]);

  const table = element("table", { className: "data-grid" });
  const headerRow = element("tr");
  const selectAll = element("input", {
    attributes: {
      type: "checkbox",
      "aria-label": "Select all records on this page",
    },
    on: {
      change: (event) => {
        state.selection = updateSelection(state.selection, pageIds, event.target.checked);
        renderGridRoute(entity);
      },
    },
  });
  selectAll.checked = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  selectAll.indeterminate =
    selectedOnPage.length > 0 && selectedOnPage.length < pageIds.length;
  headerRow.append(element("th", {}, selectAll));
  for (const [field, label] of columns) {
    const direction =
      state.sortKey === field ? (state.sortDirection === "asc" ? " ascending" : " descending") : "";
    const button = element("button", {
      type: "button",
      text: `${label}${direction}`,
      attributes: {
        "aria-label": `Sort by ${label}${direction}`,
      },
      on: {
        click: () => {
          if (state.sortKey === field) {
            state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
          } else {
            state.sortKey = field;
            state.sortDirection = "asc";
          }
          renderGridRoute(entity);
        },
      },
    });
    headerRow.append(element("th", { attributes: { scope: "col" } }, button));
  }
  table.append(element("thead", {}, headerRow));
  const body = element("tbody");
  for (const record of page.records) {
    const id = gridIdentity(entity, record);
    const row = element("tr", {
      className: state.selection.has(id) ? "selected" : "",
    });
    const checkbox = element("input", {
      attributes: {
        type: "checkbox",
        "aria-label": `Select ${record.subject || record.fullname || record.name || record.title}`,
      },
      on: {
        click: (event) => event.stopPropagation(),
        change: (event) => {
          state.selection = updateSelection(state.selection, [id], event.target.checked);
          renderGridRoute(entity);
        },
      },
    });
    checkbox.checked = state.selection.has(id);
    row.append(element("td", {}, checkbox));
    columns.forEach(([field], columnIndex) => {
      const cell = element("td");
      const value = record[field];
      if (columnIndex === 0 || (entity === "activities" && field === "subject")) {
        const targetEntity = entity === "activities" ? record.entity : entity;
        const anchor = element("a", {
          text: gridCodeLabel(
            targetEntity,
            field,
            value,
            app.twin.clock.now(),
            record.record || record,
          ),
          attributes: { href: routeForRecord(targetEntity, id) },
        });
        cell.append(anchor);
      } else {
        cell.append(displayCell(entity, field, value, record));
      }
      row.append(cell);
    });
    body.append(row);
  }
  if (!page.records.length) {
    body.append(
      element("tr", {}, [
        element(
          "td",
          {
            text: "No records match this view.",
            attributes: { colspan: String(columns.length + 1) },
          },
        ),
      ]),
    );
  }
  table.append(body);
  const previous = element("button", {
    text: "‹",
    type: "button",
    attributes: { disabled: page.page <= 1 ? "" : null, "aria-label": "Previous page" },
    on: {
      click: () => {
        state.page -= 1;
        renderGridRoute(entity);
      },
    },
  });
  const next = element("button", {
    text: "›",
    type: "button",
    attributes: {
      disabled: page.page >= page.pageCount ? "" : null,
      "aria-label": "Next page",
    },
    on: {
      click: () => {
        state.page += 1;
        renderGridRoute(entity);
      },
    },
  });
  const footer = element("footer", { className: "grid-footer" }, [
    element("span", {
      text: `${page.start}–${page.end} of ${page.total} · Page ${page.page} of ${page.pageCount}`,
    }),
    previous,
    next,
  ]);
  const shell = element("div", { className: "grid-shell" }, [
    element("div", { className: "grid-scroll" }, table),
    footer,
  ]);

  dom.viewRoot.replaceChildren(
    pageHeading(title, subtitle, TENANT_SCHEMA.apps[app.currentApp].label),
    toolbar,
    shell,
  );
  setGridCommands(entity, records, state);
  dom.viewRoot.setAttribute("aria-busy", "false");
}

async function selectedTransition(entity, action, state) {
  const records = app.data[entity].filter((record) =>
    state.selection.has(record[ENTITY_UI[entity].id]),
  );
  const eligible = records.filter((record) => record.statecode === 0);
  if (!eligible.length) return;
  const decision = await showDialog({
    title: `${action === "complete" ? "Complete" : action === "resolve" ? "Resolve" : "Cancel"} selected records?`,
    content: `This action will update ${eligible.length} selected record(s).`,
    actions: [
      { value: "back", label: "Back" },
      { value: "apply", label: "Apply", primary: true },
    ],
    cancelValue: "back",
  });
  if (decision !== "apply") return;
  const result = await safeUiBatch(
    app.twin,
    eligible.map((record) => ({
      input:
        entity === "incidents" && action === "resolve"
          ? "/api/data/v9.2/CloseIncident"
          : `/api/data/v9.2/${entity}(${record[ENTITY_UI[entity].id]})`,
      init: {
        method:
          entity === "incidents" && action === "resolve" ? "POST" : "PATCH",
        headers: { "if-match": record["@odata.etag"] },
        body:
          entity === "incidents" && action === "resolve"
            ? { IncidentId: record.incidentid, Status: 5 }
            : transitionPatch(entity, action, app.twin.clock.now()),
      },
    })),
  );
  refreshData();
  if (!result.ok) {
    showToast(result.message, "error");
    renderGridRoute(entity);
    return;
  }
  state.selection = new Set();
  showToast("Selected records were updated.");
  renderGridRoute(entity);
}

async function deleteSelected(entity, state) {
  const config = ENTITY_UI[entity];
  const selected = app.data[entity].filter((record) => state.selection.has(record[config.id]));
  if (!selected.length) return;
  const decision = await showDialog({
    title: `Delete ${selected.length} selected record(s)?`,
    content: "Records with related data cannot be deleted. This action cannot be undone.",
    actions: [
      { value: "back", label: "Back" },
      { value: "delete", label: "Delete", danger: true },
    ],
    cancelValue: "back",
  });
  if (decision !== "delete") return;
  const result = await safeUiDeleteMany(app.twin, entity, selected, app.data);
  refreshData();
  if (!result.ok) {
    showToast(result.message, "error");
    renderGridRoute(entity);
    return;
  }
  state.selection = new Set();
  showToast(`${result.completed} record(s) deleted.`);
  renderGridRoute(entity);
}

function setGridCommands(entity, records, state) {
  const commands = [];
  if (
    entity !== "activities" &&
    TENANT_SCHEMA.entities[entity]?.mutable &&
    !["emails", "msdyn_workorders", "bookableresourcebookings"].includes(entity)
  ) {
    commands.push(
      commandButton("New", "add", () => {
        requestNavigation(appHash(`${ENTITY_ROUTE[entity]}/new`));
      }),
    );
  }
  commands.push(
    commandButton("Refresh", "refresh", () => {
      refreshData();
      renderGridRoute(entity);
      showToast("View refreshed.");
    }),
  );
  if (state.selection.size) {
    commands.push("separator");
    if (["accounts", "contacts"].includes(entity)) {
      commands.push(
        commandButton(
          `Delete (${state.selection.size})`,
          "delete",
          () => deleteSelected(entity, state),
          { danger: true },
        ),
      );
    }
    if (entity === "tasks") {
      commands.push(
        commandButton("Mark Complete", "check", () =>
          selectedTransition(entity, "complete", state),
        ),
        commandButton(
          "Cancel",
          "cancel",
          () => selectedTransition(entity, "cancel", state),
          { danger: true },
        ),
      );
    }
    if (entity === "incidents") {
      commands.push(
        commandButton("Resolve", "check", () =>
          selectedTransition(entity, "resolve", state),
        ),
        commandButton(
          "Cancel",
          "cancel",
          () => selectedTransition(entity, "cancel", state),
          { danger: true },
        ),
      );
    }
  }
  setCommands(commands);
}

function renderGridRoute(entity, options = {}) {
  const focus = options.preserveFocus ? document.activeElement?.getAttribute("aria-label") : null;
  if (entity === "activities") {
    renderGrid(
      "activities",
      combineActivities(app.data.emails, app.data.tasks, app.twin.clock.now()),
      "Activities",
      "Email and task activity across customer service.",
    );
  } else {
    const config = ENTITY_UI[entity];
    renderGrid(entity, app.data[entity], config.plural, `Browse ${config.plural.toLowerCase()}.`);
  }
  if (focus) {
    const candidate = [...dom.viewRoot.querySelectorAll("[aria-label]")].find(
      (node) => node.getAttribute("aria-label") === focus,
    );
    candidate?.focus();
  }
}

function renderDashboard() {
  const dashboardId =
    app.dashboardIds.get(app.currentApp) ||
    TENANT_SCHEMA.apps[app.currentApp].dashboards[0];
  const selector = element("select", {
    attributes: { "aria-label": "Choose dashboard" },
    on: {
      change: (event) => {
        app.dashboardIds.set(app.currentApp, event.target.value);
        renderDashboard();
      },
    },
  });
  const dashboardLabels = {
    "customer-service": "Customer Service Dashboard",
    "service-activity": "Service Activity Dashboard",
    "sales-pipeline": "Sales Pipeline",
    "sales-performance": "Sales Performance",
    "field-operations": "Field Service Operations",
    "technician-day": "Technician Day",
  };
  for (const id of TENANT_SCHEMA.apps[app.currentApp].dashboards) {
    const label = dashboardLabels[id];
    const option = element("option", { text: label, attributes: { value: id } });
    if (id === dashboardId) option.selected = true;
    selector.append(option);
  }
  const components = dashboardComponents(app.data, app.twin.clock.now(), dashboardId);
  const headingTools = element("div", { className: "dashboard-toolbar" }, selector);
  const cards = element("section", {
    className: "metric-grid",
    attributes: { "aria-label": "Dashboard metrics" },
  });
  for (const [label, value] of components.cards) {
    cards.append(
      element("article", { className: "metric-card" }, [
        element("span", { text: label }),
        element("strong", { text: value }),
      ]),
    );
  }
  const charts = element("section", { className: "chart-grid" });
  for (const chart of components.charts) {
    const max = Math.max(1, ...chart.values.map((item) => item.value));
    const content = element("article", { className: "chart-card" }, [
      element("h2", { text: chart.title }),
    ]);
    for (const item of chart.values) {
      const progress = element("progress", {
        attributes: {
          max: String(max),
          value: String(item.value),
          "aria-label": `${item.label}: ${item.value}`,
        },
      });
      content.append(
        element("div", { className: "bar-row" }, [
          element("span", { text: item.label }),
          progress,
          element("strong", { text: item.value }),
        ]),
      );
    }
    charts.append(content);
  }
  dom.viewRoot.replaceChildren(
    pageHeading(
      components.title,
      `Current as of ${formatUtc(app.twin.clock.now())}.`,
      TENANT_SCHEMA.apps[app.currentApp].label,
      headingTools,
    ),
    element("div", { className: "dashboard-content" }, [cards, charts]),
  );
  setCommands([
    commandButton("Refresh", "refresh", () => {
      refreshData();
      renderDashboard();
      showToast("Dashboard refreshed.");
    }),
  ]);
  dom.viewRoot.setAttribute("aria-busy", "false");
}

function editableField(field, definition) {
  const [name, label, kind, required] = definition;
  const form = app.activeForm;
  const value = form.draft[name] ?? "";
  const schemaField = TENANT_SCHEMA.entities[form.entity]?.fields[name];
  const writable =
    !FORM_READ_ONLY.has(name) &&
    schemaField?.mutable !== false &&
    (form.isNew || form.editable);
  const labelNode = element("label", { attributes: { for: `field-${name}` } }, [
    document.createTextNode(label),
    required ? element("span", { className: "required-mark", text: " *" }) : null,
  ]);
  if (!writable) {
    const readContent =
      kind === "url" && safeExternalUrl(value)
        ? element("a", {
            text: value,
            attributes: {
              href: safeExternalUrl(value),
              target: "_blank",
              rel: "noopener noreferrer",
            },
          })
        : document.createTextNode(
            kind === "datetime"
              ? formatUtc(value)
              : name === "prioritycode"
                ? priorityLabel(value)
                : value || "—",
          );
    return element("div", { className: `form-field${kind === "textarea" ? " full" : ""}` }, [
      labelNode,
      element("div", {
        className: "read-value",
        attributes: { id: `field-${name}` },
      }, readContent),
    ]);
  }
  const inputTag = kind === "textarea" ? "textarea" : "input";
  const attributes = {
    id: `field-${name}`,
    name,
    required: required ? "" : null,
    "aria-required": required ? "true" : null,
  };
  if (inputTag === "input") {
    attributes.type =
      kind === "datetime" ? "text" : ["email", "tel", "url", "number"].includes(kind) ? kind : "text";
    attributes.value = value;
    if (kind === "datetime") attributes.placeholder = "YYYY-MM-DDTHH:mm:ss.sssZ";
  }
  const control = element(inputTag, {
    attributes,
    dataset: { writable: "true", valueType: kind },
    on: {
      input: (event) => {
        let next = event.target.value;
        if (kind === "number" && next !== "") next = Number(next);
        form.draft[name] = next;
        updateDirtyState();
      },
    },
  });
  if (inputTag === "textarea") control.value = value;
  return element("div", { className: `form-field${kind === "textarea" ? " full" : ""}` }, [
    labelNode,
    control,
  ]);
}

function addCreateLookups(container) {
  const form = app.activeForm;
  const selectField = (definition) => {
    const targets = [...lookupTargetsForApp(definition, app.currentApp)];
    const selectedType = definition.typeField
      ? form.draft[definition.typeField] || targets[0].entity
      : definition.entity;
    const selectedOutsideScope = definition.targets?.find(
      (target) => target.entity === selectedType,
    );
    if (
      selectedOutsideScope &&
      !targets.some((target) => target.entity === selectedType)
    ) {
      targets.push(selectedOutsideScope);
    }
    const recordHost = element("div");
    const renderRecordOptions = () => {
      const target =
        targets.find(
          (candidate) =>
            candidate.entity ===
            (definition.typeField
              ? form.draft[definition.typeField]
              : definition.entity),
        ) || targets[0];
      const records = (app.data[target.entity] || []).filter(
        (record) =>
          !definition.activeOnly || record.statecode === 0,
      );
      const select = element("select", {
        id: `field-${definition.field}`,
        attributes: {
          name: definition.field,
          required: definition.required ? "" : null,
          "aria-required": definition.required ? "true" : "false",
          disabled: !form.isNew && !form.editable ? "" : null,
        },
        dataset: { writable: "true", valueType: "text" },
        on: {
          change: (event) => {
            form.draft[definition.field] = event.target.value;
            updateDirtyState();
          },
        },
      });
      select.append(
        element("option", {
          text: `Select ${definition.label.toLowerCase()}`,
          attributes: { value: "" },
        }),
      );
      for (const record of records) {
        select.append(
          element("option", {
            text: record[target.textField],
            attributes: { value: record[target.idField] },
          }),
        );
      }
      select.value = lookupControlValue(form.draft, definition.field);
      recordHost.replaceChildren(select);
    };
    const children = [
      element("label", {
        text: `${definition.label}${definition.required ? " *" : ""}`,
        attributes: { for: `field-${definition.field}` },
      }),
    ];
    if (definition.typeField && targets.length > 1) {
      const typeSelect = element("select", {
        attributes: {
          "aria-label": `${definition.label} record type`,
          disabled: !form.isNew && !form.editable ? "" : null,
        },
        on: {
          change: (event) => {
            form.draft[definition.typeField] = event.target.value;
            form.draft[definition.field] = "";
            renderRecordOptions();
            updateDirtyState();
          },
        },
      });
      for (const target of targets) {
        typeSelect.append(
          element("option", {
            text: ENTITY_UI[target.entity].singular,
            attributes: { value: target.entity },
          }),
        );
      }
      typeSelect.value = selectedType;
      children.push(typeSelect);
    }
    children.push(recordHost);
    container.append(element("div", { className: "form-field" }, children));
    renderRecordOptions();
  };
  for (const definition of FORM_LOOKUPS[form.entity] || []) selectField(definition);
}

function updateDirtyState() {
  const form = app.activeForm;
  if (!form) return;
  form.dirty = !editableSnapshotsEqual(form.draft, form.baseline);
  updateFormCommands();
}

function renderFormPanel(tabId) {
  const form = app.activeForm;
  form.selectedTab = tabId;
  for (const tab of form.tabs) {
    tab.button.setAttribute("aria-selected", String(tab.id === tabId));
    tab.button.tabIndex = tab.id === tabId ? 0 : -1;
  }
  form.panel.replaceChildren();
  if (tabId === "related") {
    renderRelatedPanel(form.panel, form.entity, form.record);
    return;
  }
  const grid = element("div", { className: "form-grid" });
  if (tabId === "summary") addCreateLookups(grid);
  for (const definition of FORM_FIELDS[form.entity]?.[tabId] || []) {
    grid.append(editableField(definition[0], definition));
  }
  if (!grid.childNodes.length) {
    grid.append(element("p", { className: "empty-inline", text: "No fields are available." }));
  }
  form.panel.append(grid);
}

function relatedTable(title, columns, rows) {
  const card = element("section", { className: "panel-card" }, [element("h2", { text: title })]);
  if (!rows.length) {
    card.append(element("p", { className: "empty-inline", text: "No related records." }));
    return card;
  }
  const table = element("table", { className: "compact-table" });
  const heading = element("tr");
  for (const column of columns) heading.append(element("th", { text: column[1] }));
  table.append(element("thead", {}, heading));
  const body = element("tbody");
  for (const row of rows) {
    const line = element("tr");
    for (const [field, , renderer] of columns) {
      const cell = element("td");
      const output = renderer ? renderer(row[field], row) : row[field] ?? "—";
      cell.append(output instanceof Node ? output : document.createTextNode(String(output)));
      line.append(cell);
    }
    body.append(line);
  }
  table.append(body);
  card.append(element("div", { className: "grid-scroll" }, table));
  return card;
}

function renderRelatedPanel(container, entity, record) {
  const stack = element("div", { className: "related-stack" });
  const appendEntityTable = (title, targetEntity, rows) => {
    const config = ENTITY_UI[targetEntity];
    const columns = config.columns.slice(0, 4).map(([field, label], index) => [
      field,
      label,
      index === 0
        ? (value, row) =>
            element("a", {
              text: gridCodeLabel(
                targetEntity,
                field,
                value,
                app.twin.clock.now(),
                row,
              ),
              attributes: {
                href: routeForRecord(targetEntity, row[config.id]),
              },
            })
        : (value, row) =>
            gridCodeLabel(
              targetEntity,
              field,
              value,
              app.twin.clock.now(),
              row,
            ),
    ]);
    stack.append(relatedTable(title, columns, rows));
  };
  const activities = relatedActivities(entity, record, app.data, app.twin.clock.now());
  stack.append(
    relatedTable(
      "Recent Activities",
      [
        ["activitytype", "Type"],
        [
          "subject",
          "Subject",
          (value, row) =>
            element("a", {
              text: value,
              attributes: { href: routeForRecord(row.entity, row.activityid) },
            }),
        ],
        ["activitydate", "Date", (value) => formatUtc(value)],
        ["statuslabel", "Status", (value) => badge(value)],
      ],
      activities,
    ),
  );
  if (entity === "accounts") {
    const contacts = app.data.contacts.filter(
      (contact) => contact.parentcustomerid === record.accountid,
    );
    stack.append(
      relatedTable(
        "Contacts",
        [
          [
            "fullname",
            "Name",
            (value, row) =>
              element("a", {
                text: value,
                attributes: { href: routeForRecord("contacts", row.contactid) },
              }),
          ],
          ["jobtitle", "Job Title"],
          ["emailaddress1", "Email"],
        ],
        contacts,
      ),
    );
    appendEntityTable(
      "Cases",
      "incidents",
      app.data.incidents.filter(
        (item) =>
          (item.customeridtype === "accounts" &&
            item.customerid === record.accountid) ||
          app.data.contacts.some(
            (contact) =>
              contact.parentcustomerid === record.accountid &&
              item.primarycontactid === contact.contactid,
          ),
      ),
    );
    if (app.currentApp === "sales") {
      appendEntityTable(
        "Leads",
        "leads",
        app.data.leads.filter((item) => item.parentaccountid === record.accountid),
      );
      appendEntityTable(
        "Opportunities",
        "opportunities",
        app.data.opportunities.filter(
          (item) =>
            item.parentaccountid === record.accountid ||
            (item.customeridtype === "accounts" &&
              item.customerid === record.accountid),
        ),
      );
      for (const [title, target] of [
        ["Quotes", "quotes"],
        ["Orders", "salesorders"],
        ["Invoices", "invoices"],
      ]) {
        appendEntityTable(
          title,
          target,
          app.data[target].filter(
            (item) =>
              item.customeridtype === "accounts" &&
              item.customerid === record.accountid,
          ),
        );
      }
    }
    if (app.currentApp === "field-service") {
      const workorders = app.data.msdyn_workorders.filter(
        (item) => item.msdyn_serviceaccount === record.accountid,
      );
      appendEntityTable(
        "Customer Assets",
        "msdyn_customerassets",
        app.data.msdyn_customerassets.filter(
          (item) => item.msdyn_account === record.accountid,
        ),
      );
      appendEntityTable("Work Orders", "msdyn_workorders", workorders);
      const workorderIds = new Set(
        workorders.map((item) => item.msdyn_workorderid),
      );
      appendEntityTable(
        "Bookings",
        "bookableresourcebookings",
        app.data.bookableresourcebookings.filter((item) =>
          workorderIds.has(item.msdyn_workorder),
        ),
      );
    }
  }
  if (entity === "contacts") {
    const connections = relatedConnectionsForContact(
      app.data.connections,
      record.contactid,
      app.data.contacts,
    );
    stack.append(
      relatedTable(
        "Relationships",
        [
          [
            "toname",
            "Related Contact",
            (value, row) =>
              element("a", {
                text: value,
                attributes: { href: routeForRecord("contacts", row.toid) },
              }),
          ],
          ["fromrole", "This Contact's Role"],
          ["torole", "Related Contact's Role"],
          ["effectivestart", "Effective From", (value) => formatUtc(value)],
        ],
        connections,
      ),
    );
    if (app.currentApp === "sales") {
      appendEntityTable(
        "Leads",
        "leads",
        app.data.leads.filter((item) => item.parentcontactid === record.contactid),
      );
      appendEntityTable(
        "Opportunities",
        "opportunities",
        app.data.opportunities.filter(
          (item) =>
            item.parentcontactid === record.contactid ||
            (item.customeridtype === "contacts" &&
              item.customerid === record.contactid),
        ),
      );
    }
    if (app.currentApp === "field-service") {
      appendEntityTable(
        "Customer Assets",
        "msdyn_customerassets",
        app.data.msdyn_customerassets.filter(
          (item) => item.msdyn_contact === record.contactid,
        ),
      );
      appendEntityTable(
        "Work Orders",
        "msdyn_workorders",
        app.data.msdyn_workorders.filter(
          (item) => item.msdyn_reportedbycontact === record.contactid,
        ),
      );
    }
  }
  if (entity === "incidents") {
    appendEntityTable(
      "Work Orders",
      "msdyn_workorders",
      app.data.msdyn_workorders.filter(
        (item) => item.msdyn_servicerequest === record.incidentid,
      ),
    );
  }
  if (entity === "opportunities") {
    appendEntityTable(
      "Products",
      "opportunityproducts",
      app.data.opportunityproducts.filter(
        (item) => item.opportunityid === record.opportunityid,
      ),
    );
    appendEntityTable(
      "Quotes",
      "quotes",
      app.data.quotes.filter(
        (item) => item.opportunityid === record.opportunityid,
      ),
    );
  }
  if (entity === "quotes") {
    appendEntityTable(
      "Quote Lines",
      "quotedetails",
      app.data.quotedetails.filter((item) => item.quoteid === record.quoteid),
    );
    appendEntityTable(
      "Orders",
      "salesorders",
      app.data.salesorders.filter((item) => item.quoteid === record.quoteid),
    );
  }
  if (entity === "salesorders") {
    appendEntityTable(
      "Order Lines",
      "salesorderdetails",
      app.data.salesorderdetails.filter(
        (item) => item.salesorderid === record.salesorderid,
      ),
    );
    appendEntityTable(
      "Invoices",
      "invoices",
      app.data.invoices.filter(
        (item) => item.salesorderid === record.salesorderid,
      ),
    );
  }
  if (entity === "invoices") {
    const lines = app.data.invoicedetails.filter(
      (item) => item.invoiceid === record.invoiceid,
    );
    appendEntityTable("Invoice Lines", "invoicedetails", lines);
    const productIds = new Set(lines.map((item) => item.productid));
    appendEntityTable(
      "Installed Customer Assets",
      "msdyn_customerassets",
      app.data.msdyn_customerassets.filter(
        (item) =>
          item.msdyn_account === record.customerid &&
          productIds.has(item.msdyn_product),
      ),
    );
  }
  if (entity === "msdyn_workorders") {
    for (const [title, target, field] of [
      ["Bookings", "bookableresourcebookings", "msdyn_workorder"],
      ["Service Tasks", "msdyn_workorderservicetasks", "msdyn_workorder"],
      ["Products Used", "msdyn_workorderproducts", "msdyn_workorder"],
      ["Resource Requirements", "msdyn_resourcerequirements", "msdyn_workorder"],
    ]) {
      appendEntityTable(
        title,
        target,
        app.data[target].filter(
          (item) => item[field] === record.msdyn_workorderid,
        ),
      );
    }
  }
  if (entity === "msdyn_customerassets") {
    appendEntityTable(
      "Service History",
      "msdyn_workorders",
      app.data.msdyn_workorders.filter(
        (item) => item.msdyn_customerasset === record.msdyn_customerassetid,
      ),
    );
  }
  container.append(stack);
}

function domainActionDescriptors(entity, record) {
  if (
    entity === "incidents" &&
    record.statecode === 0
  ) {
    return [
      {
        action: "CreateWorkOrder",
        label: "Create Work Order",
        payload: () => ({ CaseId: record.incidentid }),
        navigate: "msdyn_workorders",
      },
    ];
  }
  if (entity === "leads") {
    return record.statecode === 0
      ? [
          {
            action: "QualifyLead",
            label: "Qualify",
            payload: () => ({ LeadId: record.leadid, CreateOpportunity: true }),
          },
          {
            action: "DisqualifyLead",
            label: "Disqualify",
            payload: () => ({ LeadId: record.leadid, Status: 4 }),
            danger: true,
          },
        ]
      : [
          {
            action: "ReopenLead",
            label: "Reopen",
            payload: () => ({ LeadId: record.leadid }),
          },
        ];
  }
  if (entity === "opportunities") {
    return record.statecode === 0
      ? [
          {
            action: "GenerateQuote",
            label: "Generate Quote",
            payload: () => ({ OpportunityId: record.opportunityid }),
            navigate: "quotes",
          },
          {
            action: "WinOpportunity",
            label: "Close as Won",
            payload: () => ({ OpportunityId: record.opportunityid }),
          },
          {
            action: "LoseOpportunity",
            label: "Close as Lost",
            payload: () => ({ OpportunityId: record.opportunityid, Status: 4 }),
            danger: true,
          },
        ]
      : [
          {
            action: "ReopenOpportunity",
            label: "Reopen",
            payload: () => ({ OpportunityId: record.opportunityid }),
          },
        ];
  }
  if (entity === "quotes") {
    if (record.statecode === 0) {
      return [
        {
          action: "ActivateQuote",
          label: "Activate",
          payload: () => ({ QuoteId: record.quoteid }),
        },
      ];
    }
    if (record.statecode === 1) {
      return [
        {
          action: "ReviseQuote",
          label: "Revise",
          payload: () => ({ QuoteId: record.quoteid }),
          navigate: "quotes",
        },
        {
          action: "ConvertQuoteToSalesOrder",
          label: "Create Order",
          payload: () => ({ QuoteId: record.quoteid }),
          navigate: "salesorders",
        },
        {
          action: "WinQuote",
          label: "Win Quote",
          payload: () => ({ QuoteId: record.quoteid }),
        },
        {
          action: "CloseQuote",
          label: "Close Quote",
          payload: () => ({ QuoteId: record.quoteid, Status: 5 }),
          danger: true,
        },
      ];
    }
    if (record.statecode === 2) {
      return [
        {
          action: "ConvertQuoteToSalesOrder",
          label: "Create Order",
          payload: () => ({ QuoteId: record.quoteid }),
          navigate: "salesorders",
        },
      ];
    }
  }
  if (entity === "salesorders") {
    if ([0, 1].includes(record.statecode)) {
      return [
        {
          action: "FulfillSalesOrder",
          label: "Fulfill",
          payload: () => ({ SalesOrderId: record.salesorderid }),
        },
        {
          action: "CancelSalesOrder",
          label: "Cancel Order",
          payload: () => ({ SalesOrderId: record.salesorderid }),
          danger: true,
        },
      ];
    }
    if (record.statecode === 3) {
      return [
        {
          action: "ConvertSalesOrderToInvoice",
          label: "Create Invoice",
          payload: () => ({ SalesOrderId: record.salesorderid }),
          navigate: "invoices",
        },
      ];
    }
  }
  if (entity === "invoices" && record.statecode === 0) {
    return [
      {
        action: "MarkInvoicePaid",
        label: "Mark Paid",
        payload: () => ({ InvoiceId: record.invoiceid }),
      },
      {
        action: "CancelInvoice",
        label: "Cancel Invoice",
        payload: () => ({ InvoiceId: record.invoiceid }),
        danger: true,
      },
    ];
  }
  if (entity === "msdyn_workorders") {
    if (record.statecode === 1) {
      return [
        {
          action: "ReopenWorkOrder",
          label: "Reopen",
          payload: () => ({ WorkOrderId: record.msdyn_workorderid }),
        },
      ];
    }
    const actions = [];
    if (record.msdyn_systemstatus === 690970000) {
      actions.push({
        action: "ScheduleWorkOrder",
        label: "Schedule",
        payload: () => {
          const requirement = app.data.msdyn_resourcerequirements.find(
            (candidate) =>
              candidate.msdyn_workorder === record.msdyn_workorderid &&
              candidate.msdyn_isprimary &&
              candidate.statecode === 0,
          );
          const start = new Date(requirement.msdyn_fromdate);
          const end = new Date(
            Math.min(
              start.valueOf() + 2 * 3600000,
              Date.parse(requirement.msdyn_todate),
            ),
          );
          return {
            WorkOrderId: record.msdyn_workorderid,
            ResourceId: app.data.bookableresources.find(
              (resource) => resource.statecode === 0,
            ).bookableresourceid,
            StartTime: start.toISOString(),
            EndTime: end.toISOString(),
          };
        },
      });
    }
    if (record.msdyn_systemstatus === 690970001) {
      actions.push({
        action: "DispatchWorkOrder",
        label: "Dispatch",
        payload: () => ({ WorkOrderId: record.msdyn_workorderid }),
      });
      actions.push({
        action: "StartWorkOrder",
        label: "Start Service",
        payload: () => ({ WorkOrderId: record.msdyn_workorderid }),
      });
    }
    if (record.msdyn_systemstatus === 690970002) {
      actions.push({
        action: "CompleteWorkOrder",
        label: "Complete",
        payload: () => ({ WorkOrderId: record.msdyn_workorderid }),
      });
    }
    actions.push({
      action: "CancelWorkOrder",
      label: "Cancel",
      payload: () => ({ WorkOrderId: record.msdyn_workorderid }),
      danger: true,
    });
    return actions;
  }
  if (entity === "bookableresourcebookings" && record.statecode === 0) {
    return [
      {
        action: "CompleteBooking",
        label: "Complete",
        payload: () => ({ BookingId: record.bookableresourcebookingid }),
      },
      {
        action: "CancelBooking",
        label: "Cancel",
        payload: () => ({ BookingId: record.bookableresourcebookingid }),
        danger: true,
      },
    ];
  }
  return [];
}

async function runDomainAction(descriptor) {
  const form = app.activeForm;
  if (!form || form.isNew) return;
  const decision = await showDialog({
    title: descriptor.label,
    content: form.dirty
      ? `${descriptor.label} will save your edits first and then run atomically.`
      : `${descriptor.label} will update this synthetic tenant atomically.`,
    actions: [
      { value: "back", label: "Back" },
      {
        value: "apply",
        label: descriptor.label,
        primary: !descriptor.danger,
        danger: descriptor.danger,
      },
    ],
    cancelValue: "back",
  });
  if (decision !== "apply") return;
  let current = form.record;
  if (form.dirty) {
    current = await saveActiveForm({ rerender: false });
    if (!current) return;
  }
  const outcome = await safeUiRequest(
    app.twin,
    (() => {
      const action = TENANT_SCHEMA.actions.find(
        (candidate) => candidate.name === descriptor.action,
      );
      const id = current[TENANT_SCHEMA.entities[action.bindingEntitySet].key];
      return `/api/data/v9.2/${action.bindingEntitySet}(${id})/Microsoft.Dynamics.CRM.${action.name}`;
    })(),
    {
      method: "POST",
      headers: { "if-match": current["@odata.etag"] },
      body: descriptor.payload(current),
    },
    { expectJson: true },
  );
  if (!outcome.ok) {
    showToast(outcome.message, "error");
    return;
  }
  refreshData();
  showToast(`${descriptor.label} completed.`);
  if (descriptor.navigate && outcome.data.primary) {
    const config = ENTITY_UI[descriptor.navigate];
    const created = outcome.data.created?.find(
      (item) => item.entity === descriptor.navigate,
    );
    const id = created?.id || outcome.data.primary[config.id];
    if (id) {
      app.activeForm = null;
      await requestNavigation(routeForRecord(descriptor.navigate, id), {
        skipGuard: true,
      });
      return;
    }
  }
  const latest = app.data[form.entity].find(
    (record) => record[form.idField] === form.id,
  );
  if (latest) renderRecordForm(form.entity, latest);
}

function updateFormCommands() {
  const form = app.activeForm;
  if (!form) return;
  const commands = [];
  commands.push(commandButton("Back", "back", () => window.history.back()));
  if (form.isNew) {
    commands.push(
      commandButton("Save", "save", () => saveActiveForm(), { disabled: false }),
    );
  } else {
    for (const action of recordCommandActions(form.entity, form.record, {
      dirty: form.dirty,
      entityEditable: form.editable,
    })) {
      if (action.id === "back") continue;
      if (action.id === "save") {
        commands.push(
          commandButton("Save", "save", () => saveActiveForm(), {
            disabled: action.disabled,
          }),
        );
      } else if (action.id === "refresh") {
        commands.push(
          commandButton("Refresh", "refresh", () => reloadCurrentRecord()),
        );
      } else if (action.id === "delete") {
        commands.push(
          commandButton("Delete", "delete", () => deleteCurrentRecord(), { danger: true }),
        );
      } else {
        commands.push(
          commandButton(
            action.label,
            action.id === "complete" || action.id === "resolve" || action.id === "reopen"
              ? "check"
              : "cancel",
            () => transitionCurrentRecord(action.id),
            { danger: action.id === "cancel" },
          ),
        );
      }
    }
    for (const descriptor of domainActionDescriptors(form.entity, form.record)) {
      commands.push(
        commandButton(
          descriptor.label,
          descriptor.danger ? "cancel" : "check",
          () => runDomainAction(descriptor),
          { danger: descriptor.danger },
        ),
      );
    }
  }
  setCommands(commands);
}

function initializeForm(entity, record, isNew) {
  const config = ENTITY_UI[entity];
  let draft = {};
  for (const section of ["summary", "details"]) {
    for (const [field] of FORM_FIELDS[entity]?.[section] || []) {
      draft[field] = record?.[field] ?? "";
    }
  }
  draft = initializeLookupDraft(entity, record, draft, app.currentApp);
  const lineParents = {
    opportunityproducts: ["opportunities", "opportunityid", "opportunityid"],
    quotedetails: ["quotes", "quoteid", "quoteid"],
    salesorderdetails: ["salesorders", "salesorderid", "salesorderid"],
    invoicedetails: ["invoices", "invoiceid", "invoiceid"],
  };
  const lineParent = lineParents[entity];
  const parentEditable =
    !lineParent ||
    app.data[lineParent[0]].find(
      (candidate) => candidate[lineParent[2]] === record?.[lineParent[1]],
    )?.statecode === 0;
  const editable =
    isNew ||
    (parentEditable &&
      isRecordEditable(entity, record, entity !== "emails"));
  app.activeForm = {
    entity,
    idField: config.id,
    id: record?.[config.id] || null,
    record,
    isNew,
    editable,
    etag: record?.["@odata.etag"] || null,
    draft,
    baseline: normalizeEditableSnapshot(draft),
    dirty: false,
    selectedTab: "summary",
    tabs: [],
    panel: null,
  };
}

function renderRecordForm(entity, record, isNew = false) {
  const config = ENTITY_UI[entity];
  initializeForm(entity, record, isNew);
  const form = app.activeForm;
  const title = isNew ? `New ${config.singular}` : record[config.primary];
  const status = isNew
    ? "Unsaved"
    : entity === "incidents"
      ? `${caseStatusLabel(record)} · ${caseStatusReasonLabel(record)}`
      : entity === "tasks"
        ? taskStatusLabel(record, app.twin.clock.now())
        : entity === "emails"
          ? record.directioncode
            ? "Sent"
            : "Received"
          : record["statecode@OData.Community.Display.V1.FormattedValue"] ||
            (record.statecode === 0 ? "Active" : "Inactive");
  const shell = element("article", { className: "record-shell" });
  shell.append(
    element("header", { className: "record-header" }, [
      element("span", { className: "heading-kicker", text: config.singular }),
      element("h1", { text: title, attributes: { tabindex: "-1" } }),
      element("div", { className: "record-meta" }, [
        badge(status),
        !isNew && record.owneridname
          ? element("span", { text: `Owner: ${record.owneridname}` })
          : null,
        !isNew && record.modifiedon
          ? element("span", { text: `Modified: ${formatUtc(record.modifiedon)}` })
          : null,
      ]),
    ]),
  );
  const tabsNode = element("div", {
    className: "record-tabs",
    attributes: { role: "tablist", "aria-label": `${config.singular} form sections` },
  });
  const tabDefinitions = [
    { id: "summary", label: "Summary", disabled: false },
    { id: "details", label: "Details", disabled: false },
    {
      id: "related",
      label: "Related",
      disabled:
        isNew ||
        ![
          "accounts",
          "contacts",
          "incidents",
          "opportunities",
          "quotes",
          "salesorders",
          "invoices",
          "msdyn_workorders",
          "msdyn_customerassets",
        ].includes(entity),
    },
  ];
  form.tabs = tabDefinitions.map((definition, index) => {
    const button = element("button", {
      className: "record-tab",
      text: definition.label,
      type: "button",
      attributes: {
        role: "tab",
        "aria-selected": index === 0 ? "true" : "false",
        "aria-controls": "record-tabpanel",
        disabled: definition.disabled ? "" : null,
        tabindex: index === 0 ? "0" : "-1",
      },
      on: {
        click: () => renderFormPanel(definition.id),
        keydown: (event) => {
          const current = form.tabs.findIndex((item) => item.id === definition.id);
          const next = nextRovingTabIndex(form.tabs, current, event.key);
          if (next !== current && next >= 0) {
            event.preventDefault();
            form.tabs[next].button.focus();
            renderFormPanel(form.tabs[next].id);
          }
        },
      },
    });
    tabsNode.append(button);
    return { ...definition, button };
  });
  shell.append(tabsNode);
  form.panel = element("section", {
    id: "record-tabpanel",
    className: "record-panel",
    attributes: { role: "tabpanel", tabindex: "0" },
  });
  shell.append(form.panel);
  dom.viewRoot.replaceChildren(shell);
  renderFormPanel("summary");
  updateFormCommands();
  dom.viewRoot.setAttribute("aria-busy", "false");
}

function createPayload(form) {
  return createFormPayload(form.entity, form.draft);
}

function updatePayload(form) {
  const payload = {};
  for (const section of ["summary", "details"]) {
    for (const [field, , kind] of FORM_FIELDS[form.entity]?.[section] || []) {
      if (FORM_READ_ONLY.has(field)) {
        continue;
      }
      const before = form.record[field] ?? "";
      let after = form.draft[field] ?? "";
      if (editableSnapshotsEqual({ value: before }, { value: after })) continue;
      if (kind === "number" && after !== "") after = Number(after);
      payload[field] = after === "" ? null : after;
    }
  }
  return { ...payload, ...lookupPayload(form.entity, form.draft, form.record) };
}

async function saveActiveForm(options = {}) {
  const form = app.activeForm;
  if (!form) return null;
  const payload = form.isNew ? createPayload(form) : updatePayload(form);
  if (!form.isNew && !Object.keys(payload).length) {
    showToast("No changes to save.");
    return form.record;
  }
  const path = form.isNew
    ? `/api/data/v9.2/${form.entity}`
    : `/api/data/v9.2/${form.entity}(${form.id})`;
  const headers = { prefer: "return=representation" };
  if (!form.isNew) headers["if-match"] = form.etag;
  const outcome = await safeUiRequest(
    app.twin,
    path,
    {
      method: form.isNew ? "POST" : "PATCH",
      headers,
      body: payload,
    },
    { expectJson: true },
  );
  if (outcome.status === 412) {
    const choice = await showDialog({
      title: "This record changed",
      content: "Another client saved a newer version. Reload it or keep your unsaved edits.",
      actions: [
        { value: "keep", label: "Keep editing" },
        { value: "reload", label: "Reload latest", primary: true },
      ],
      cancelValue: "keep",
    });
    if (choice === "reload") await reloadCurrentRecord({ discard: true });
    return null;
  }
  if (!outcome.ok) {
    showToast(outcome.message, "error");
    return null;
  }
  const saved = outcome.data;
  refreshData();
  showToast(`${ENTITY_UI[form.entity].singular} saved.`);
  if (form.isNew) {
    app.activeForm = null;
    app.historyIndex = replaceCreatedRecordHistory(
      app.historyIndex,
      routeForRecord(form.entity, saved[ENTITY_UI[form.entity].id]),
      window.history.replaceState.bind(window.history),
    );
    if (options.rerender !== false) await renderRoute();
    return saved;
  }
  form.record = saved;
  form.etag = saved["@odata.etag"];
  form.draft = { ...form.draft };
  for (const key of Object.keys(form.draft)) form.draft[key] = saved[key] ?? "";
  form.baseline = normalizeEditableSnapshot(form.draft);
  form.dirty = false;
  if (options.rerender !== false) renderRecordForm(form.entity, saved, false);
  else updateFormCommands();
  return saved;
}

async function reloadCurrentRecord(options = {}) {
  const form = app.activeForm;
  if (!form || form.isNew) return;
  if (form.dirty && !options.discard) {
    const choice = await showDialog({
      title: "Discard edits and refresh?",
      content: "Refreshing loads the current record and discards unsaved edits.",
      actions: [
        { value: "stay", label: "Stay" },
        { value: "refresh", label: "Discard and refresh", primary: true },
      ],
      cancelValue: "stay",
    });
    if (choice !== "refresh") return;
  }
  const outcome = await safeUiRequest(
    app.twin,
    `/api/data/v9.2/${form.entity}(${form.id})`,
    {},
    { expectJson: true },
  );
  if (!outcome.ok) {
    showToast(outcome.message, "error");
    return;
  }
  const record = outcome.data;
  refreshData();
  renderRecordForm(form.entity, record);
  showToast("Latest record loaded.");
}

async function transitionCurrentRecord(action) {
  const form = app.activeForm;
  if (!form || form.isNew) return;
  const verb =
    action === "complete"
      ? "mark this task complete"
      : action === "resolve"
        ? "resolve this case"
        : action === "reopen"
          ? "reopen this case"
          : `cancel this ${ENTITY_UI[form.entity].singular.toLowerCase()}`;
  const lifecycle = await runConfirmedLifecycleAction({
    dirty: form.dirty,
    record: form.record,
    requestConfirmation: async () => {
      const decision = await showDialog({
        title: "Confirm status change",
        content: form.dirty
          ? `Do you want to ${verb}? Your unsaved edits will be saved first.`
          : `Do you want to ${verb}?`,
        actions: [
          { value: "back", label: "Back" },
          {
            value: "apply",
            label: "Apply",
            primary: action !== "cancel",
            danger: action === "cancel",
          },
        ],
        cancelValue: "back",
      });
      return decision === "apply";
    },
    save: () => saveActiveForm({ rerender: false }),
    transition: (saved) =>
      safeUiRequest(
        app.twin,
        form.entity === "incidents" && action === "resolve"
          ? "/api/data/v9.2/CloseIncident"
          : `/api/data/v9.2/${form.entity}(${form.id})`,
        {
          method:
            form.entity === "incidents" && action === "resolve"
              ? "POST"
              : "PATCH",
          headers: {
            "if-match": saved["@odata.etag"],
            prefer: "return=representation",
          },
          body:
            form.entity === "incidents" && action === "resolve"
              ? { IncidentId: form.id, Status: 5 }
              : transitionPatch(form.entity, action, app.twin.clock.now()),
        },
        { expectJson: true },
      ),
  });
  if (lifecycle.cancelled) return;
  if (lifecycle.stage === "save") {
    showToast("Status was not changed because the record could not be saved.", "error");
    return;
  }
  const outcome = lifecycle.result;
  if (!outcome) {
    showToast(
      `Status was not changed: ${lifecycle.error?.message || "the transition failed."}`,
      "error",
    );
    return;
  }
  if (outcome.status === 412) {
    await showDialog({
      title: "Status was not changed",
      content: "The record has a newer version. Refresh before trying again.",
    });
    return;
  }
  if (!outcome.ok) {
    showToast(outcome.message, "error");
    return;
  }
  const updated = outcome.data.primary || outcome.data;
  refreshData();
  renderRecordForm(form.entity, updated);
  showToast("Status updated.");
}

async function deleteCurrentRecord() {
  const form = app.activeForm;
  if (!form || form.isNew) return;
  const lifecycle = await runConfirmedLifecycleAction({
    dirty: form.dirty,
    record: form.record,
    requestConfirmation: async () => {
      const choice = await showDialog({
        title: `Delete this ${ENTITY_UI[form.entity].singular.toLowerCase()}?`,
        content: form.dirty
          ? "Your unsaved edits will be saved first. Records with related data cannot be deleted."
          : "Records with related data cannot be deleted. This action cannot be undone.",
        actions: [
          { value: "back", label: "Back" },
          { value: "delete", label: "Delete", danger: true },
        ],
        cancelValue: "back",
      });
      return choice === "delete";
    },
    save: () => saveActiveForm({ rerender: false }),
    transition: (saved) =>
      safeUiRequest(
        app.twin,
        `/api/data/v9.2/${form.entity}(${form.id})`,
        {
          method: "DELETE",
          headers: { "if-match": saved["@odata.etag"] },
        },
      ),
  });
  if (lifecycle.cancelled) return;
  if (lifecycle.stage === "save") {
    showToast("Delete was not attempted because the record could not be saved.", "error");
    return;
  }
  const outcome = lifecycle.result;
  if (!outcome) {
    showToast(
      `Delete was not completed: ${lifecycle.error?.message || "the request failed."}`,
      "error",
    );
    return;
  }
  if (!outcome.ok) {
    showToast(outcome.message, "error");
    return;
  }
  refreshData();
  app.activeForm = null;
  showToast(`${ENTITY_UI[form.entity].singular} deleted.`);
  await requestNavigation(appHash(ENTITY_ROUTE[form.entity]), {
    skipGuard: true,
    force: true,
  });
}

async function renderRecordRoute(entity, id) {
  if (!ENTITY_UI[entity]) {
    renderNotFound();
    return;
  }
  if (id === "new") {
    const empty = {};
    for (const section of ["summary", "details"]) {
      for (const [field] of FORM_FIELDS[entity]?.[section] || []) empty[field] = "";
    }
    renderRecordForm(entity, empty, true);
    return;
  }
  const record = app.data[entity].find((item) => item[ENTITY_UI[entity].id] === id);
  if (!record) {
    dom.viewRoot.replaceChildren(
      element("div", { className: "error-state" }, [
        element("h1", { text: "Record not found" }),
        element("p", { text: "The requested record does not exist in this session." }),
      ]),
    );
    setCommands([commandButton("Back", "back", () => window.history.back())]);
    dom.viewRoot.setAttribute("aria-busy", "false");
    return;
  }
  renderRecordForm(entity, record);
}

function emptyPage(title, message, kicker) {
  const illustration = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  illustration.setAttribute("viewBox", "0 0 64 64");
  illustration.setAttribute("class", "search-empty-icon");
  illustration.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M11 15h42v34H11zM18 23h28M18 31h22M18 39h14");
  illustration.append(path);
  dom.viewRoot.replaceChildren(
    pageHeading(title, "", kicker),
    element("div", { className: "empty-state" }, [
      illustration,
      element("h2", { text: "Nothing here yet" }),
      element("p", { text: message }),
    ]),
  );
  setCommands([commandButton("Refresh", "refresh", () => renderRoute())]);
  dom.viewRoot.setAttribute("aria-busy", "false");
}

function renderKnowledgeSearch() {
  const form = element("form", { className: "knowledge-search-box", attributes: { role: "search" } });
  const input = element("input", {
    attributes: {
      type: "search",
      placeholder: "Search knowledge",
      "aria-label": "Search knowledge",
    },
  });
  const button = element("button", { text: "Search", type: "submit" });
  form.append(input, button);
  const result = element("div", { className: "empty-state" }, [
    element("h2", { text: "Search the knowledge base" }),
    element("p", {
      text: "No knowledge articles are published in this customer service environment.",
    }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    result.replaceChildren(
      element("h2", { text: "No results" }),
      element("p", {
        text: input.value.trim()
          ? `No published articles match “${input.value.trim()}”.`
          : "Enter a search term to find published articles.",
      }),
    );
  });
  dom.viewRoot.replaceChildren(
    pageHeading("Knowledge Search", "Find published support guidance.", "Knowledge"),
    form,
    result,
  );
  setCommands([]);
  dom.viewRoot.setAttribute("aria-busy", "false");
}

function renderGlobalSearch(route) {
  const query = route.query.get("q") || "";
  const rows = [];
  const searchable = Object.entries(TENANT_SCHEMA.entities)
    .filter(
      ([entity, definition]) =>
        ENTITY_ROUTE[entity] &&
        (definition.appScopes.includes(app.currentApp) ||
          definition.appScopes.includes("shared")),
    )
    .map(([entity]) => entity);
  for (const entity of searchable) {
    const config = ENTITY_UI[entity];
    const matches = searchRows(app.data[entity], config.search, query, (record, field, value) =>
      gridCodeLabel(entity, field, value, app.twin.clock.now(), record),
    );
    for (const record of matches) {
      rows.push({
        entity,
        id: record[config.id],
        type: config.singular,
        name: record[config.primary],
        detail:
          record.accountnumber ||
          record.parentcustomeridname ||
          record.ticketnumber ||
          "",
      });
    }
  }
  rows.sort((left, right) => codeUnitCompare(left.name, right.name) || codeUnitCompare(left.id, right.id));
  const list = relatedTable(
    "Results",
    [
      ["type", "Record Type"],
      [
        "name",
        "Name",
        (value, row) =>
          element("a", { text: value, attributes: { href: routeForRecord(row.entity, row.id) } }),
      ],
      ["detail", "Details"],
    ],
    query ? rows : [],
  );
  dom.viewRoot.replaceChildren(
    pageHeading(
      "Search Results",
      query ? `${rows.length} result(s) for “${query}”.` : "Enter a term in global search.",
      TENANT_SCHEMA.apps[app.currentApp].label,
    ),
    element("div", { className: "record-panel" }, list),
  );
  setCommands([]);
  dom.viewRoot.setAttribute("aria-busy", "false");
}

async function resetSimulation() {
  const choice = await showDialog({
    title: "Reset browser session?",
    content: "All browser-local writes, faults, and virtual-time changes will return to the fixture baseline.",
    actions: [
      { value: "back", label: "Back" },
      { value: "reset", label: "Reset session", danger: true },
    ],
    cancelValue: "back",
  });
  if (choice !== "reset") return;
  app.twin.reset();
  refreshData();
  showToast("Browser session reset.");
  renderSimulationSettings();
}

function renderSimulationSettings() {
  const timeValue = element("strong", { text: formatUtc(app.twin.clock.now()) });
  const advance = (milliseconds, label) => {
    app.twin.advanceTime(milliseconds);
    refreshData();
    showToast(`Virtual time advanced ${label}.`);
    renderSimulationSettings();
  };
  const timeCard = element("section", { className: "management-card" }, [
    element("h2", { text: "Virtual UTC clock" }),
    element("p", {}, ["Current time: ", timeValue]),
    element("p", {
      text: "Advancing time can breach case targets and make open tasks overdue. It does not complete tasks.",
    }),
    element("div", { className: "management-actions" }, [
      element("button", {
        className: "secondary-button",
        text: "Advance 1 hour",
        type: "button",
        on: { click: () => advance(3600000, "one hour") },
      }),
      element("button", {
        className: "secondary-button",
        text: "Advance 1 day",
        type: "button",
        on: { click: () => advance(86400000, "one day") },
      }),
      element("button", {
        className: "secondary-button",
        text: "Advance 7 days",
        type: "button",
        on: { click: () => advance(7 * 86400000, "seven days") },
      }),
    ]),
  ]);
  const faultCard = element("section", { className: "management-card" }, [
    element("h2", { text: "Next-request behavior" }),
    element("p", {
      text: "Choose a deterministic response condition for the next matching request.",
    }),
    element("div", { className: "management-actions" }, [
      ...[
        ["429 then retry", { type: "http-429", retryAfterMs: 500 }],
        ["503 then retry", { type: "http-503", retryAfterMs: 500 }],
        ["Network failure", { type: "network", times: 2 }],
        ["Timeout", { type: "timeout", delayMs: 30000, times: 2 }],
        ["Malformed response", { type: "malformed" }],
      ].map(([label, fault]) =>
        element("button", {
          className: "secondary-button",
          text: label,
          type: "button",
          on: {
            click: () => {
              app.twin.setFaultPlan([fault]);
              showToast(`${label} is armed for the next request.`);
              renderSimulationSettings();
            },
          },
        }),
      ),
      element("button", {
        className: "secondary-button",
        text: "Clear faults",
        type: "button",
        on: {
          click: () => {
            app.twin.clearFaults();
            showToast("Fault plan cleared.");
            renderSimulationSettings();
          },
        },
      }),
    ]),
  ]);
  const resetCard = element("section", { className: "management-card wide" }, [
    element("h2", { text: "Session data" }),
    element("p", {
      text: "Changes are deterministic and remain only in this browser tab. Reset restores the committed synthetic fixture.",
    }),
    element("div", { className: "management-actions" }, [
      element("button", {
        className: "danger-button",
        text: "Reset browser session",
        type: "button",
        on: { click: resetSimulation },
      }),
    ]),
  ]);
  dom.viewRoot.replaceChildren(
    pageHeading(
      "Simulation settings",
      "Control deterministic browser-local behavior.",
      "Service Management",
    ),
    element("div", { className: "management-layout" }, [timeCard, faultCard, resetCard]),
  );
  setCommands([]);
  dom.viewRoot.setAttribute("aria-busy", "false");
}

function renderApiSimulation() {
  const method = element("select", { attributes: { "aria-label": "HTTP method" } });
  for (const value of ["GET", "POST", "PATCH", "DELETE"]) {
    method.append(element("option", { text: value, attributes: { value } }));
  }
  const path = element("input", {
    attributes: {
      type: "text",
      value: "/api/data/v9.2/accounts?$top=3&$count=true",
      "aria-label": "API path",
    },
  });
  const body = element("textarea", {
    attributes: {
      "aria-label": "JSON request body",
      placeholder: '{"name":"Example"}',
    },
  });
  const output = element("pre", { className: "code-block", text: "No request sent." });
  const send = element("button", {
    className: "primary-button",
    text: "Send request",
    type: "button",
    on: {
      click: async () => {
        if (!path.value.startsWith("/api/data/v9.2/")) {
          output.textContent = "Paths must begin with /api/data/v9.2/.";
          return;
        }
        const init = {
          method: method.value,
          retry: { maxAttempts: 3, baseDelayMs: 500 },
        };
        if (method.value !== "GET" && method.value !== "DELETE" && body.value.trim()) {
          init.body = body.value;
          init.headers = { prefer: "return=representation" };
        }
        try {
          const response = await app.twin.fetch(path.value, init);
          const text = await response.text();
          output.textContent = `HTTP ${response.status}\n${text || "(empty response)"}`;
          refreshData();
        } catch (error) {
          output.textContent = `${error.name}: ${error.message}`;
        }
      },
    },
  });
  const requestCard = element("section", { className: "management-card wide" }, [
    element("h2", { text: "Injected API client" }),
    element("div", { className: "request-form" }, [method, path, body]),
    element("div", { className: "management-actions" }, [send]),
    output,
  ]);
  const scenarioOutput = element("pre", { className: "code-block", text: "No scenario run." });
  const scenarioButtons = BUILT_IN_SCENARIOS.map((scenario) =>
    element("button", {
      className: "secondary-button",
      text: scenario.name,
      type: "button",
      on: {
        click: async () => {
          try {
            const result = await runBuiltInScenario(app.twin, scenario.id);
            scenarioOutput.textContent = JSON.stringify(result, null, 2);
            refreshData();
          } catch (error) {
            scenarioOutput.textContent = `${error.name}: ${error.message}`;
          }
        },
      },
    }),
  );
  const scenarioCard = element("section", { className: "management-card" }, [
    element("h2", { text: "Deterministic scenarios" }),
    element("div", { className: "management-actions" }, scenarioButtons),
    scenarioOutput,
  ]);
  const traceOutput = element("pre", {
    className: "trace-list",
    text: JSON.stringify(app.twin.trace.slice(-20), null, 2),
  });
  const traceCard = element("section", { className: "management-card" }, [
    element("h2", { text: "Event trace" }),
    element("p", { text: `${app.twin.trace.length} append-only event(s) in this tab.` }),
    element("div", { className: "management-actions" }, [
      element("button", {
        className: "secondary-button",
        text: "Refresh trace",
        type: "button",
        on: { click: renderApiSimulation },
      }),
      element("button", {
        className: "secondary-button",
        text: "Export run",
        type: "button",
        on: {
          click: () => {
            traceOutput.textContent = JSON.stringify(app.twin.exportRun(), null, 2);
          },
        },
      }),
      element("button", {
        className: "secondary-button",
        text: "Replay run",
        type: "button",
        on: {
          click: async () => {
            try {
              const replayed = await replayRun(app.twin.exportRun());
              traceOutput.textContent = JSON.stringify(
                {
                  expected: app.twin.stateDigest(),
                  replayed: replayed.stateDigest(),
                  matches: app.twin.stateDigest() === replayed.stateDigest(),
                },
                null,
                2,
              );
            } catch (error) {
              traceOutput.textContent = `${error.name}: ${error.message}`;
            }
          },
        },
      }),
    ]),
    traceOutput,
  ]);
  const boundaryCard = element("section", { className: "management-card wide" }, [
    element("h2", { text: "Deployment boundary" }),
    element("p", {
      text: "Hosted JSON files are read-only OData-shaped fixtures. Queries, writes, retries, faults, concurrency, virtual time, traces, reset, export, and replay run only in this injected browser-local runtime.",
    }),
    element("p", {
      text: "This independent project is unaffiliated and is not a production service replacement.",
    }),
    element("p", {
      text: `Compatibility profile: ${TENANT_SCHEMA.compatibilityProfile.name} · source date ${TENANT_SCHEMA.compatibilityProfile.sourceDate} · trial parity unverified.`,
    }),
    element("p", {
      text: TENANT_SCHEMA.simulatorPolicies.join(" "),
    }),
  ]);
  dom.viewRoot.replaceChildren(
    pageHeading(
      "API & simulation",
      "Inspect the browser-local Dataverse-shaped runtime.",
      "Service Management",
    ),
    element("div", { className: "management-layout" }, [
      requestCard,
      scenarioCard,
      traceCard,
      boundaryCard,
    ]),
  );
  setCommands([]);
  dom.viewRoot.setAttribute("aria-busy", "false");
}

function renderNotFound() {
  dom.viewRoot.replaceChildren(
    element("div", { className: "error-state" }, [
      element("h1", { text: "Page not found" }),
      element("p", {
        text: `Choose an area from the ${TENANT_SCHEMA.apps[app.currentApp].label} sitemap.`,
      }),
      element("a", {
        text: "Go to Dashboards",
        attributes: { href: appHash("dashboard") },
      }),
    ]),
  );
  setCommands([]);
  dom.viewRoot.setAttribute("aria-busy", "false");
}

async function renderRoute() {
  const token = ++app.navigationToken;
  let route = parseRoute();
  if (!route.prefixed) {
    const query = route.query.toString();
    const replacement = appHash(
      `${route.key || "dashboard"}${query ? `?${query}` : ""}`,
      "customer-service",
    );
    window.history.replaceState(
      { appIndex: app.historyIndex },
      "",
      replacement,
    );
    route = parseRoute(replacement);
  }
  app.route = route;
  updateAppShell(route.appId);
  closeNavigation();
  closeFlyouts();
  setActiveNavigation(route);
  dom.viewRoot.setAttribute("aria-busy", "true");
  dom.viewRoot.replaceChildren(
    element("div", { className: "loading-state", attributes: { role: "status" } }, [
      element("span", { className: "spinner", attributes: { "aria-hidden": "true" } }),
      element("span", { text: "Loading" }),
    ]),
  );
  const [first, second] = route.segments;
  if (token !== app.navigationToken) return;
  if (!first || first === "dashboard") renderDashboard();
  else if (first === "activities") renderGridRoute("activities");
  else if (ROUTE_ENTITY[first]) await renderRecordOrGrid(ROUTE_ENTITY[first], second);
  else if (first === "queues") {
    emptyPage("Queues", "No queues are configured for this environment.", "Service");
  } else if (first === "knowledge-articles") {
    emptyPage(
      "Knowledge Articles",
      "No knowledge articles are published in this environment.",
      "Knowledge",
    );
  } else if (first === "knowledge-search") renderKnowledgeSearch();
  else if (first === "search") renderGlobalSearch(route);
  else if (first === "service-management" && second === "simulation-settings") {
    renderSimulationSettings();
  } else if (first === "service-management" && second === "api-simulation") {
    renderApiSimulation();
  } else renderNotFound();
  document.querySelector(".page-heading h1, .record-header h1, .error-state h1")?.focus();
}

async function renderRecordOrGrid(entity, id) {
  if (!id) {
    app.activeForm = null;
    renderGridRoute(entity);
  } else {
    await renderRecordRoute(entity, id);
  }
}

async function loadSeed() {
  const url = new URL("./data/seed.json", import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fixture load failed with HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) throw new Error("Fixture response is not JSON.");
  return response.json();
}

function installShellEvents() {
  dom.dialogClose.addEventListener("click", () => {
    app.dialogResolve?.(app.dialogCancelValue);
  });
  dom.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    app.dialogResolve?.(app.dialogCancelValue);
  });
  dom.navigationToggle.addEventListener("click", openNavigation);
  dom.navigationClose.addEventListener("click", closeNavigation);
  dom.scrim.addEventListener("click", closeNavigation);
  dom.appLauncher.addEventListener("click", () =>
    toggleFlyout(dom.appMenu, dom.appLauncher, dom.appSelector),
  );
  dom.appSelector.addEventListener("click", () =>
    toggleFlyout(dom.appMenu, dom.appLauncher, dom.appSelector),
  );
  dom.quickCreate.addEventListener("click", () =>
    toggleFlyout(dom.quickMenu, dom.quickCreate),
  );
  dom.globalSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = dom.globalSearchInput.value.trim();
    requestNavigation(appHash(`search?q=${encodeURIComponent(query)}`));
  });
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a");
    if (!anchor) {
      if (!event.target.closest(".header-flyout, #app-launcher, #app-selector, #quick-create")) {
        closeFlyouts();
      }
      return;
    }
    const raw = anchor.getAttribute("href") || "";
    const target = anchor.getAttribute("target");
    if (
      shouldInterceptSkipLink({
        href: raw,
        defaultPrevented: event.defaultPrevented,
      })
    ) {
      event.preventDefault();
      dom.mainContent.focus();
      return;
    }
    if (
      shouldInterceptSpaNavigation({
        href: raw,
        defaultPrevented: event.defaultPrevented,
        button: event.button,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        target,
      })
    ) {
      event.preventDefault();
      requestNavigation(raw);
    }
  });
  window.addEventListener("popstate", handlePopState);
}

async function boot() {
  installShellEvents();
  try {
    app.seed = await loadSeed();
    app.twin = createTwin({
      seed: app.seed,
      retry: { maxAttempts: 1, baseDelayMs: 500, maxDelayMs: 5000 },
    });
    refreshData();
    if (!window.location.hash.startsWith("#/")) {
      window.history.replaceState({ appIndex: 0 }, "", "#/cs/dashboard");
    } else if (!Number.isSafeInteger(window.history.state?.appIndex)) {
      window.history.replaceState({ appIndex: 0 }, "", window.location.href);
    }
    app.historyIndex = window.history.state?.appIndex || 0;
    await renderRoute();
  } catch (error) {
    dom.viewRoot.setAttribute("aria-busy", "false");
    dom.viewRoot.replaceChildren(
      element("div", { className: "error-state" }, [
        svgIcon("warning"),
        element("h1", { text: "Application could not start" }),
        element("p", { text: error.message }),
        element("p", {
          text: "Serve the site directory through a static HTTP server and try again.",
        }),
      ]),
    );
    setCommands([]);
    dom.errorRegion.textContent = error.message;
  }
}

boot();
