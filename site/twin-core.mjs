import { TENANT_CONFIG, TENANT_SCHEMA } from "./tenant-schema.mjs";

const API_MARKER = "/api/data/v9.2/";
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const MUTATION_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const RETRYABLE_STATUS = new Set([429, 503]);
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const ACTION_DEFINITIONS = Object.freeze(
  Object.fromEntries(TENANT_SCHEMA.actions.map((action) => [action.name, action])),
);

function optionMap(entity, field) {
  return Object.freeze(
    Object.fromEntries(
      (TENANT_SCHEMA.entities[entity].fields[field]?.options || []).map((item) => [
        item.value,
        item.label,
      ]),
    ),
  );
}

function runtimeType(field) {
  const token = field.runtimeType;
  return `${token}${field.nullable ? "?" : ""}`;
}

function deriveEntityDefinitions() {
  const definitions = {};
  for (const [entitySet, schema] of Object.entries(TENANT_SCHEMA.entities)) {
    const fields = {};
    const discriminators = {};
    const ranges = {};
    const readOnly = [];
    for (const [name, field] of Object.entries(schema.fields)) {
      if (name !== schema.key) fields[name] = runtimeType(field);
      if (field.discriminator) discriminators[name] = Object.freeze([...field.discriminator]);
      if (field.minimum !== undefined || field.maximum !== undefined) {
        ranges[name] = Object.freeze([
          field.minimum ?? Number.MIN_SAFE_INTEGER,
          field.maximum ?? Number.MAX_SAFE_INTEGER,
        ]);
      }
      if (!field.mutable || name === schema.key) readOnly.push(name);
    }
    definitions[entitySet] = Object.freeze({
      id: schema.key,
      logicalName: schema.logicalName,
      primaryName: schema.primaryName,
      required: Object.freeze([...schema.requiredOnCreate]),
      statePairs: Object.freeze(
        schema.statusPairs.map((pair) => `${pair.statecode}:${pair.statuscode}`),
      ),
      activeStatePairs: Object.freeze(
        schema.activeStatusPairs.map(
          (pair) => `${pair.statecode}:${pair.statuscode}`,
        ),
      ),
      discriminators: Object.freeze(discriminators),
      ranges: Object.freeze(ranges),
      fields: Object.freeze(fields),
      readOnly: Object.freeze(new Set(readOnly)),
      mutable: schema.mutable,
      deletePolicy: schema.deletePolicy,
      appScopes: Object.freeze([...schema.appScopes]),
      schema,
    });
  }
  return Object.freeze(definitions);
}

export const ENTITY_DEFINITIONS = deriveEntityDefinitions();
const caseStatusLabels = optionMap("incidents", "statuscode");
export const CASE_STATUS_REASONS = Object.freeze(
  Object.fromEntries(
    Object.entries(
      TENANT_SCHEMA.entities.incidents.statusPairs.reduce((groups, pair) => {
        groups[pair.statecode] ||= {};
        groups[pair.statecode][pair.statuscode] = caseStatusLabels[pair.statuscode];
        return groups;
      }, {}),
    ).map(([state, reasons]) => [state, Object.freeze(reasons)]),
  ),
);
const CASE_PRIORITY_LABELS = optionMap("incidents", "prioritycode");
const CASE_ORIGIN_LABELS = optionMap("incidents", "caseorigincode");
const CASE_TYPE_LABELS = optionMap("incidents", "casetypecode");
const CASE_STATE_LABELS = optionMap("incidents", "statecode");
const EMAIL_DIRECTION_RULES = Object.freeze({
  true: Object.freeze({
    senderType: "systemusers",
    recipientType: "contacts",
    statecode: 1,
    statuscode: 3,
    status: "Sent",
  }),
  false: Object.freeze({
    senderType: "contacts",
    recipientType: "systemusers",
    statecode: 1,
    statuscode: 4,
    status: "Received",
  }),
});
const SALES_LINE_CONTRACTS = Object.freeze({
  opportunityproducts: Object.freeze({
    parentEntity: "opportunities",
    parentField: "opportunityid",
  }),
  quotedetails: Object.freeze({
    parentEntity: "quotes",
    parentField: "quoteid",
  }),
  salesorderdetails: Object.freeze({
    parentEntity: "salesorders",
    parentField: "salesorderid",
  }),
  invoicedetails: Object.freeze({
    parentEntity: "invoices",
    parentField: "invoiceid",
  }),
});
const CLOSED_HEADER_ENTITIES = new Set([
  "leads",
  "opportunities",
  "quotes",
  "salesorders",
  "invoices",
]);
const WORK_ORDER_CHILD_ENTITIES = new Set([
  "msdyn_resourcerequirements",
  "msdyn_workorderservicetasks",
  "msdyn_workorderproducts",
  "msdyn_workorderservices",
  "msdyn_workorderincidents",
  "bookableresourcebookings",
]);
const TERMINAL_WORK_ORDER_STATUSES = new Set([
  690970003,
  690970004,
  690970005,
]);


function assertJsonValue(value, path = "$", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError(`${path} contains an unsafe integer`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains non-JSON value ${typeof value}`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a recursive value`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} contains a non-JSON object`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`, seen);
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new TypeError(`${path} contains symbol keys`);
    }
  }
  seen.delete(value);
}

function clone(value) {
  assertJsonValue(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => clone(item));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical values must contain finite numbers");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort(codeUnitCompare)
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`unsupported canonical value: ${typeof value}`);
}

export function canonicalStringify(value) {
  assertJsonValue(value);
  return canonicalValue(value);
}

export function codeUnitCompare(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function utf8Bytes(input) {
  return new TextEncoder().encode(String(input));
}

export function sha256(input) {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  const rotate = (value, amount) => (value >>> amount) | (value << (32 - amount));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotate(words[index - 15], 7) ^
        rotate(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rotate(words[index - 2], 17) ^
        rotate(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + sum1 + choose + constants[index] + words[index]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function deterministicGuid(seed) {
  const hex = sha256(String(seed)).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function recordEtag(record, revision = 0, resetGeneration = 0) {
  const clean = {};
  for (const key of Object.keys(record).sort(codeUnitCompare)) {
    if (key !== "@odata.etag") clean[key] = record[key];
  }
  return `W/"rt-g${resetGeneration}-r${revision}-${sha256(canonicalStringify(clean)).slice(0, 20)}"`;
}

export function normalizeUtc(value, field = "datetime") {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  if (!match) {
    throw new TypeError(`${field} must include an explicit UTC offset`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "000",
    , sign, offsetHourText = "00", offsetMinuteText = "00"] = match;
  const [year, month, day, hour, minute, second, millisecondsPart, offsetHour, offsetMinute] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fraction,
    offsetHourText,
    offsetMinuteText,
  ].map(Number);
  if (
    month < 1 || month > 12 ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    throw new TypeError(`${field} is not a valid datetime`);
  }
  const local = new Date(0);
  local.setUTCHours(0, 0, 0, 0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecondsPart);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second ||
    local.getUTCMilliseconds() !== millisecondsPart
  ) {
    throw new TypeError(`${field} is not a valid datetime`);
  }
  const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (sign === "-" ? -1 : 1);
  const milliseconds = local.getTime() - offset;
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${field} is not a valid datetime`);
  return new Date(milliseconds).toISOString();
}

export class VirtualClock {
  constructor(epoch) {
    this.initial = normalizeUtc(epoch, "epoch");
    this.milliseconds = Date.parse(this.initial);
  }

  now() {
    return new Date(this.milliseconds).toISOString();
  }

  valueOf() {
    return this.milliseconds;
  }

  advance(milliseconds) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new TypeError("virtual time advance must be a non-negative safe integer");
    }
    const prospective = this.milliseconds + milliseconds;
    if (
      !Number.isSafeInteger(prospective) ||
      Math.abs(prospective) > MAX_DATE_MILLISECONDS ||
      !Number.isFinite(new Date(prospective).getTime())
    ) {
      throw new RangeError("virtual time advance exceeds the supported datetime range");
    }
    this.milliseconds = prospective;
    return this.now();
  }

  set(value) {
    const normalized = normalizeUtc(value);
    const next = Date.parse(normalized);
    if (next < this.milliseconds) throw new RangeError("virtual time cannot move backward");
    this.milliseconds = next;
    return this.now();
  }

  reset() {
    this.milliseconds = Date.parse(this.initial);
    return this.now();
  }
}

export class TwinTransportError extends Error {
  constructor(message, code = "ETRANSPORT") {
    super(message);
    this.name = "TwinTransportError";
    this.code = code;
  }
}

export class TwinRetryExhaustedError extends Error {
  constructor(message, attempts, response = null, cause = null) {
    super(message);
    this.name = "TwinRetryExhaustedError";
    this.attempts = attempts;
    this.response = response;
    this.cause = cause;
  }
}

export class TwinReplayDivergenceError extends Error {
  constructor(message, operationIndex = null) {
    super(message);
    this.name = "TwinReplayDivergenceError";
    this.operationIndex = operationIndex;
  }
}

class TwinHeaders {
  constructor(input = {}) {
    this.values = new Map();
    if (input instanceof TwinHeaders) {
      for (const [key, value] of input.entries()) this.set(key, value);
    } else if (Array.isArray(input)) {
      for (const [key, value] of input) this.set(key, value);
    } else if (input && typeof input.forEach === "function") {
      input.forEach((value, key) => this.set(key, value));
    } else {
      for (const [key, value] of Object.entries(input || {})) this.set(key, value);
    }
  }

  set(name, value) {
    this.values.set(String(name).toLowerCase(), String(value));
  }

  get(name) {
    return this.values.get(String(name).toLowerCase()) ?? null;
  }

  has(name) {
    return this.values.has(String(name).toLowerCase());
  }

  entries() {
    return this.values.entries();
  }

  toObject() {
    return Object.fromEntries([...this.values.entries()].sort(([a], [b]) => codeUnitCompare(a, b)));
  }
}

export class TwinResponse {
  constructor(body = "", options = {}) {
    this.status = options.status ?? 200;
    this.statusText = options.statusText ?? "";
    this.headers = new TwinHeaders(options.headers);
    this.bodyText = typeof body === "string" ? body : canonicalStringify(body);
    this.ok = this.status >= 200 && this.status < 300;
  }

  async json() {
    return JSON.parse(this.bodyText);
  }

  async text() {
    return this.bodyText;
  }

  clone() {
    return new TwinResponse(this.bodyText, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
  }
}

function responseJson(value, status = 200, headers = {}) {
  return new TwinResponse(value, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function emptyResponse(status = 204, headers = {}) {
  return new TwinResponse("", { status, headers });
}

function errorResponse(status, code, message, target = null) {
  const error = { code, message };
  if (target) error.target = target;
  return responseJson({ error }, status);
}

function normalizedRecordId(value) {
  const result = String(value || "").toLowerCase();
  if (!GUID_PATTERN.test(result)) throw new TypeError("record id must be a GUID");
  return result;
}

export function parsePath(input) {
  const rawInput = String(input);
  if (/%(?![0-9a-fA-F]{2})/.test(rawInput)) {
    throw new TypeError("request URL contains malformed percent encoding");
  }
  try {
    decodeURIComponent(rawInput.replace(/\+/g, " "));
  } catch {
    throw new TypeError("request URL contains malformed percent encoding");
  }
  let url;
  try {
    url = new URL(rawInput, "https://static.invalid/");
  } catch {
    throw new TypeError("request URL is malformed");
  }
  let path = url.pathname;
  const markerIndex = path.indexOf(API_MARKER);
  if (markerIndex >= 0) path = path.slice(markerIndex + API_MARKER.length);
  else path = path.replace(/^\/+/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    throw new TypeError("request path contains malformed percent encoding");
  }
  if (!path) return { kind: "root", query: url.searchParams, pathname: path };
  if (path === "WhoAmI" || path === "WhoAmI.json") {
    return { kind: "whoami", query: url.searchParams, pathname: path };
  }
  if (path === "$metadata" || path === "$metadata.json") {
    return { kind: "metadata", query: url.searchParams, pathname: path };
  }
  if (ACTION_DEFINITIONS[path]) {
    return {
      kind: "action",
      action: path,
      entity: ACTION_DEFINITIONS[path].bindingEntitySet,
      query: url.searchParams,
      pathname: path,
    };
  }
  const boundAction = path.match(
    /^([^/]+)\(([^)]+)\)\/(?:Microsoft\.Dynamics\.CRM\.)?([A-Za-z][A-Za-z0-9]*)$/,
  );
  if (boundAction && ACTION_DEFINITIONS[boundAction[3]]) {
    return {
      kind: "action",
      action: boundAction[3],
      entity: boundAction[1],
      id: normalizedRecordId(boundAction[2]),
      query: url.searchParams,
      pathname: path,
    };
  }
  const recordOpen = path.indexOf("(");
  if (recordOpen >= 0) {
    if (!path.endsWith(")") || path.indexOf("(", recordOpen + 1) >= 0) {
      throw new TypeError("record path is malformed");
    }
    const entity = path.slice(0, recordOpen);
    const rawId = path.slice(recordOpen + 1, -1);
    return {
      kind: "record",
      entity,
      id: normalizedRecordId(rawId),
      query: url.searchParams,
      pathname: path,
    };
  }
  const segments = path.split("/");
  if (segments.length === 2 && segments[1]) {
    return {
      kind: "record",
      entity: segments[0],
      id: normalizedRecordId(segments[1]),
      query: url.searchParams,
      pathname: path,
    };
  }
  if (segments.length !== 1) throw new TypeError("request path is malformed");
  return {
    kind: "collection",
    entity: path.replace(/\.json$/, ""),
    query: url.searchParams,
    pathname: path,
  };
}

function parseBody(body) {
  if (body === undefined || body === null || body === "") return {};
  if (typeof body === "string") {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new TypeError("request body is not valid JSON");
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new TypeError("request body must be a JSON object");
    }
    assertJsonValue(parsed, "request body");
    return parsed;
  }
  if (Array.isArray(body) || typeof body !== "object") {
    throw new TypeError("request body must be a JSON object");
  }
  assertJsonValue(body, "request body");
  return clone(body);
}

function validateFieldType(field, type, value, schemaField = null) {
  const nullable = type.endsWith("?");
  const base = nullable ? type.slice(0, -1) : type;
  if (value === null) {
    if (nullable) return null;
    throw new TypeError(`${field} cannot be null`);
  }
  if (base === "string" && typeof value === "string") return value;
  if (base === "boolean" && typeof value === "boolean") return value;
  if (base === "integer" && Number.isSafeInteger(value)) return value;
  if (base === "integer64" && Number.isSafeInteger(value)) return value;
  if (base === "decimal" && typeof value === "string") {
    const scale = schemaField?.scale;
    if (
      !Number.isInteger(scale) ||
      !new RegExp(`^-?(?:0|[1-9]\\d*)\\.\\d{${scale}}$`).test(value)
    ) {
      throw new TypeError(`${field} must be a canonical scale-${scale} decimal string`);
    }
    return value;
  }
  if (base === "guid") return normalizedRecordId(value);
  if (base === "datetime") return normalizeUtc(value, field);
  if (base === "entity" && typeof value === "string") return value;
  if (base === "url" && typeof value === "string") {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new TypeError(`${field} must be a valid URL`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new TypeError(`${field} must use http or https`);
    }
    return parsed.href;
  }
  throw new TypeError(`${field} must be ${base}`);
}

function decimalUnits(value, scale, canonical = true) {
  const pattern = canonical
    ? new RegExp(`^-?(?:0|[1-9]\\d*)\\.\\d{${scale}}$`)
    : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`value must be a scale-${scale} decimal`);
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > scale) throw new TypeError(`decimal exceeds scale ${scale}`);
  const units = BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
  return negative ? -units : units;
}

function decimalText(units, scale) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const digits = absolute.toString().padStart(scale + 1, "0");
  const result =
    scale === 0
      ? digits
      : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative && absolute !== 0n ? `-${result}` : result;
}

function roundDivide(numerator, denominator) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

function minBigInt(...values) {
  return values.reduce(
    (minimum, value) => (value < minimum ? value : minimum),
    values[0],
  );
}

function multiplyDecimal(left, leftScale, right, rightScale, outputScale = 2) {
  const product =
    decimalUnits(left, leftScale) * decimalUnits(right, rightScale);
  const reduction = leftScale + rightScale - outputScale;
  const units =
    reduction > 0
      ? roundDivide(product, 10n ** BigInt(reduction))
      : product * 10n ** BigInt(-reduction);
  return decimalText(units, outputScale);
}

function compareSchemaBound(value, bound, schemaField) {
  if (schemaField.runtimeType === "decimal") {
    const scale = schemaField.scale;
    const left = decimalUnits(value, scale);
    const right = decimalUnits(String(bound), scale, false);
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return value < bound ? -1 : value > bound ? 1 : 0;
}

function validateFieldConstraints(entity, field, value) {
  if (value === null || value === undefined) return value;
  const definition = ENTITY_DEFINITIONS[entity];
  const schemaField = definition.schema.fields[field];
  const allowedDiscriminators = definition.discriminators[field];
  if (allowedDiscriminators && !allowedDiscriminators.includes(value)) {
    throw new TypeError(
      `${field} must be one of ${allowedDiscriminators.join(", ")}`,
    );
  }
  if (
    schemaField.minimum !== undefined &&
    compareSchemaBound(value, schemaField.minimum, schemaField) < 0
  ) {
    throw new TypeError(`${field} must be at least ${schemaField.minimum}`);
  }
  if (
    schemaField.maximum !== undefined &&
    compareSchemaBound(value, schemaField.maximum, schemaField) > 0
  ) {
    throw new TypeError(`${field} must be at most ${schemaField.maximum}`);
  }
  if (
    schemaField.options &&
    !schemaField.options.some((option) => option.value === value)
  ) {
    throw new TypeError(`${field} has an undeclared option value`);
  }
  return value;
}

function validatePayload(entity, body, method) {
  const definition = ENTITY_DEFINITIONS[entity];
  if (!definition.mutable) {
    throw new TypeError(`${entity} is read-only`);
  }
  const clean = {};
  for (const [field, value] of Object.entries(body)) {
    if (field.startsWith("@") || field.includes("@OData.")) {
      throw new TypeError(`${field} is an annotation and cannot be written`);
    }
    if (definition.readOnly.has(field) || field === definition.id) {
      throw new TypeError(`${field} is read-only`);
    }
    const type = definition.fields[field];
    if (!type) throw new TypeError(`${field} is not valid for ${entity}`);
    clean[field] = validateFieldType(
      field,
      type,
      value,
      definition.schema.fields[field],
    );
    validateFieldConstraints(entity, field, clean[field]);
  }
  if (method === "POST" && Object.keys(clean).length === 0) {
    throw new TypeError("create payload cannot be empty");
  }
  return clean;
}

function validateActionPayload(route, body) {
  const descriptor = ACTION_DEFINITIONS[route.action];
  if (!descriptor) throw new TypeError(`action ${route.action} is not registered`);
  if (route.id && route.entity !== descriptor.bindingEntitySet) {
    throw new TypeError(
      `${route.action} must be bound to ${descriptor.bindingEntitySet}`,
    );
  }
  const parameters = new Map(
    descriptor.parameters.map((parameter) => [parameter.name, parameter]),
  );
  const clean = {};
  for (const [name, value] of Object.entries(body)) {
    const parameter = parameters.get(name);
    if (!parameter) {
      throw new TypeError(`${name} is not valid for action ${route.action}`);
    }
    if (value === null) {
      if (!parameter.nullable) throw new TypeError(`${name} cannot be null`);
      clean[name] = null;
      continue;
    }
    const runtimeType =
      parameter.type === "decimal" ? "decimal" : parameter.type;
    const normalized = validateFieldType(
      name,
      runtimeType,
      value,
      parameter.type === "decimal" ? { scale: parameter.scale } : null,
    );
    if (parameter.minimum !== undefined) {
      const below =
        parameter.type === "decimal"
          ? decimalUnits(normalized, parameter.scale) <
            decimalUnits(String(parameter.minimum), parameter.scale, false)
          : normalized < parameter.minimum;
      if (below) throw new TypeError(`${name} is below its minimum`);
    }
    if (parameter.maximum !== undefined) {
      const above =
        parameter.type === "decimal"
          ? decimalUnits(normalized, parameter.scale) >
            decimalUnits(String(parameter.maximum), parameter.scale, false)
          : normalized > parameter.maximum;
      if (above) throw new TypeError(`${name} exceeds its maximum`);
    }
    if (parameter.values && !parameter.values.includes(normalized)) {
      throw new TypeError(`${name} has an invalid value`);
    }
    clean[name] = normalized;
  }
  for (const parameter of descriptor.parameters) {
    if (parameter.required && clean[parameter.name] === undefined) {
      throw new TypeError(`${route.action} requires ${parameter.name}`);
    }
  }
  const suppliedTargets = descriptor.targetParameters.filter(
    (name) => clean[name] !== undefined,
  );
  if (!route.id && suppliedTargets.length === 0) {
    throw new TypeError(
      `${route.action} requires ${descriptor.targetParameters[0]}`,
    );
  }
  if (
    suppliedTargets.length > 1 &&
    suppliedTargets.some((name) => clean[name] !== clean[suppliedTargets[0]])
  ) {
    throw new TypeError(`${route.action} target parameters disagree`);
  }
  if (
    route.id &&
    suppliedTargets.some((name) => clean[name] !== route.id)
  ) {
    throw new TypeError(`${route.action} payload target differs from its binding`);
  }
  return clean;
}

function validateRequiredFields(entity, record) {
  for (const field of ENTITY_DEFINITIONS[entity].required) {
    const value = record[field];
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
      throw new TypeError(`${field} is required`);
    }
  }
  const stateVector = `${record.statecode}:${record.statuscode}`;
  if (
    ENTITY_DEFINITIONS[entity].statePairs.length &&
    !ENTITY_DEFINITIONS[entity].statePairs.includes(stateVector)
  ) {
    throw new TypeError(`statecode/statuscode pair ${stateVector} is invalid for ${entity}`);
  }
  if (entity === "emails") {
    const rule = EMAIL_DIRECTION_RULES[String(record.directioncode)];
    if (!rule) throw new TypeError("directioncode must be boolean");
    if (record.statecode !== rule.statecode || record.statuscode !== rule.statuscode) {
      throw new TypeError(
        `${rule.status} email requires statecode/statuscode ${rule.statecode}:${rule.statuscode}`,
      );
    }
    if (
      record.senderidtype !== rule.senderType ||
      record.recipientidtype !== rule.recipientType
    ) {
      throw new TypeError(
        `${rule.status} email requires ${rule.senderType} sender and ${rule.recipientType} recipient`,
      );
    }
  }
}

function tokenizeFilter(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "(" || character === ")" || character === ",") {
      tokens.push({ type: character, value: character });
      index += 1;
      continue;
    }
    if (character === "'") {
      let value = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "'") {
          if (source[index + 1] === "'") {
            value += "'";
            index += 2;
          } else {
            index += 1;
            closed = true;
            break;
          }
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (!closed) throw new TypeError("$filter contains an unterminated string");
      tokens.push({ type: "string", value });
      continue;
    }
    let end = index;
    while (
      end < source.length &&
      !/\s/.test(source[end]) &&
      !["(", ")", ","].includes(source[end])
    ) {
      end += 1;
    }
    const word = source.slice(index, end);
    if (!word) throw new TypeError("$filter contains unsupported syntax");
    if (/^-?\d+(?:\.\d+)?$/.test(word)) {
      const value = Number(word);
      if (!Number.isFinite(value)) throw new TypeError("$filter number is invalid");
      tokens.push({ type: "number", value, raw: word });
    } else if (word === "true" || word === "false") {
      tokens.push({ type: "boolean", value: word === "true" });
    } else if (word === "null") {
      tokens.push({ type: "null", value: null });
    } else {
      tokens.push({ type: "word", value: word });
    }
    index = end;
  }
  return tokens;
}

function queryFieldSchema(entity, field) {
  const definition = ENTITY_DEFINITIONS[entity];
  if (field === definition.id) return { base: "guid", nullable: false };
  if (field === "@odata.etag") return { base: "string", nullable: false };
  const type = definition.fields[field];
  if (!type) return null;
  return {
    base: type.endsWith("?") ? type.slice(0, -1) : type,
    nullable: type.endsWith("?"),
    scale: definition.schema.fields[field]?.scale,
  };
}

function parseFilterLiteral(token, schema, field) {
  if (!token) throw new TypeError(`$filter value for ${field} is missing`);
  if (token.type === "null") return null;
  if (["string", "url", "entity"].includes(schema.base)) {
    if (token.type !== "string") {
      throw new TypeError(`$filter value for ${field} must be a string literal`);
    }
    return token.value;
  }
  if (schema.base === "integer") {
    if (token.type !== "number" || !Number.isSafeInteger(token.value)) {
      throw new TypeError(`$filter value for ${field} must be an Int32 literal`);
    }
    if (token.value < -2_147_483_648 || token.value > 2_147_483_647) {
      throw new TypeError(`$filter value for ${field} is outside the Int32 range`);
    }
    return token.value;
  }
  if (schema.base === "integer64") {
    if (token.type !== "number" || !Number.isSafeInteger(token.value)) {
      throw new TypeError(`$filter value for ${field} must be an Int64 literal`);
    }
    return token.value;
  }
  if (schema.base === "decimal") {
    if (token.type !== "number") {
      throw new TypeError(`$filter value for ${field} must be a decimal literal`);
    }
    try {
      return decimalText(decimalUnits(token.raw, schema.scale, false), schema.scale);
    } catch {
      throw new TypeError(`$filter value for ${field} must fit scale ${schema.scale}`);
    }
  }
  if (schema.base === "boolean") {
    if (token.type !== "boolean") {
      throw new TypeError(`$filter value for ${field} must be a boolean literal`);
    }
    return token.value;
  }
  if (schema.base === "guid") {
    if (!["word", "string"].includes(token.type)) {
      throw new TypeError(`$filter value for ${field} must be a GUID literal`);
    }
    try {
      return normalizedRecordId(token.value);
    } catch {
      throw new TypeError(`$filter value for ${field} must be a valid GUID`);
    }
  }
  if (schema.base === "datetime") {
    if (!["word", "string"].includes(token.type)) {
      throw new TypeError(`$filter value for ${field} must be a DateTimeOffset literal`);
    }
    try {
      return normalizeUtc(token.value, `$filter value for ${field}`);
    } catch {
      throw new TypeError(`$filter value for ${field} must be a valid DateTimeOffset`);
    }
  }
  throw new TypeError(`$filter does not support ${field}`);
}

function compileFilter(source, entity) {
  if (!source) return () => true;
  if (source.length > 1000) throw new TypeError("$filter is too long");
  const tokens = tokenizeFilter(source);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = (type, value = null) => {
    const token = tokens[cursor];
    if (!token || token.type !== type || (value !== null && token.value !== value)) {
      throw new TypeError("$filter contains unsupported syntax");
    }
    cursor += 1;
    return token;
  };
  const fieldName = () => {
    const name = take("word").value;
    const schema = queryFieldSchema(entity, name);
    if (!schema) throw new TypeError(`$filter field ${name} is not declared`);
    return { name, schema };
  };
  const predicate = () => {
    const first = peek();
    if (!first) throw new TypeError("$filter ends unexpectedly");
    if (first.type === "(") {
      take("(");
      const nested = expression();
      take(")");
      return nested;
    }
    if (first.type === "word" && ["contains", "startswith", "endswith"].includes(first.value)) {
      const operation = take("word").value;
      take("(");
      const { name: field, schema } = fieldName();
      take(",");
      const expectedToken = tokens[cursor];
      if (!expectedToken) throw new TypeError(`${operation} requires a string literal`);
      cursor += 1;
      take(")");
      if (!["string", "url"].includes(schema.base) || expectedToken.type !== "string") {
        throw new TypeError(`${operation} requires a string literal`);
      }
      const expected = expectedToken.value;
      return (record) => {
        const actual = record[field];
        if (typeof actual !== "string") return false;
        if (operation === "contains") return actual.includes(expected);
        if (operation === "startswith") return actual.startsWith(expected);
        return actual.endsWith(expected);
      };
    }
    const { name: field, schema } = fieldName();
    const operator = take("word").value;
    if (!["eq", "ne", "gt", "ge", "lt", "le"].includes(operator)) {
      throw new TypeError(`$filter operator ${operator} is not supported`);
    }
    const expected = parseFilterLiteral(tokens[cursor], schema, field);
    cursor += 1;
    if (
      !["eq", "ne"].includes(operator) &&
      (expected === null || ["boolean", "guid"].includes(schema.base))
    ) {
      throw new TypeError(`$filter operator ${operator} is invalid for ${field}`);
    }
    return (record) => {
      const actual = record[field] ?? null;
      const comparison =
        schema.base === "decimal" && actual !== null && expected !== null
          ? decimalUnits(actual, schema.scale) - decimalUnits(expected, schema.scale)
          : null;
      if (operator === "eq") return comparison === null ? actual === expected : comparison === 0n;
      if (operator === "ne") return comparison === null ? actual !== expected : comparison !== 0n;
      if (actual === null || expected === null) return false;
      if (comparison !== null) {
        if (operator === "gt") return comparison > 0n;
        if (operator === "ge") return comparison >= 0n;
        if (operator === "lt") return comparison < 0n;
        return comparison <= 0n;
      }
      if (operator === "gt") return actual > expected;
      if (operator === "ge") return actual >= expected;
      if (operator === "lt") return actual < expected;
      return actual <= expected;
    };
  };
  const conjunction = () => {
    let left = predicate();
    while (peek()?.type === "word" && peek().value === "and") {
      take("word", "and");
      const right = predicate();
      const prior = left;
      left = (record) => prior(record) && right(record);
    }
    return left;
  };
  const expression = () => {
    let left = conjunction();
    while (peek()?.type === "word" && peek().value === "or") {
      take("word", "or");
      const right = conjunction();
      const prior = left;
      left = (record) => prior(record) || right(record);
    }
    return left;
  };
  const compiled = expression();
  if (cursor !== tokens.length) throw new TypeError("$filter contains trailing syntax");
  return compiled;
}

function availableFields(records, entity) {
  return new Set([
    ENTITY_DEFINITIONS[entity].id,
    "@odata.etag",
    ...Object.keys(ENTITY_DEFINITIONS[entity].fields),
  ]);
}

function applyQuery(records, route) {
  const supported = new Set(["$select", "$filter", "$orderby", "$top", "$skip", "$count"]);
  for (const key of route.query.keys()) {
    if (!supported.has(key)) throw new TypeError(`query option ${key} is not supported`);
    if (route.query.getAll(key).length !== 1) throw new TypeError(`query option ${key} cannot repeat`);
  }
  const fields = availableFields(records, route.entity);
  if (route.query.has("$filter") && !route.query.get("$filter")) {
    throw new TypeError("$filter cannot be empty");
  }
  const filter = compileFilter(route.query.get("$filter") || "", route.entity);
  let result = records.filter(filter);
  const orderText = route.query.get("$orderby");
  if (orderText) {
    const clauses = orderText.split(",").map((item) => {
      const parts = item.trim().split(/\s+/);
      if (!parts[0] || parts.length > 2 || !queryFieldSchema(route.entity, parts[0])) {
        throw new TypeError("$orderby contains an undeclared field");
      }
      const direction = parts[1] || "asc";
      if (!["asc", "desc"].includes(direction)) {
        throw new TypeError("$orderby direction must be asc or desc");
      }
      return [parts[0], direction];
    });
    const idField = ENTITY_DEFINITIONS[route.entity].id;
    result = result.slice().sort((left, right) => {
      for (const [field, direction] of clauses) {
        const a = left[field];
        const b = right[field];
        let comparison = 0;
        if (a === null || a === undefined) comparison = b === null || b === undefined ? 0 : -1;
        else if (b === null || b === undefined) comparison = 1;
        else if (typeof a === "number" && typeof b === "number") comparison = a - b;
        else if (queryFieldSchema(route.entity, field)?.base === "decimal") {
          const scale = queryFieldSchema(route.entity, field).scale;
          const difference = decimalUnits(a, scale) - decimalUnits(b, scale);
          comparison = difference < 0n ? -1 : difference > 0n ? 1 : 0;
        }
        else comparison = codeUnitCompare(a, b);
        if (comparison) return direction === "desc" ? -comparison : comparison;
      }
      return codeUnitCompare(left[idField], right[idField]);
    });
  }
  const total = result.length;
  const integerOption = (name, fallback) => {
    const raw = route.query.get(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw)) throw new TypeError(`${name} must be a non-negative integer`);
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) throw new TypeError(`${name} is too large`);
    return parsed;
  };
  const skip = integerOption("$skip", 0);
  const top = Math.min(integerOption("$top", 5000), 5000);
  result = result.slice(skip, skip + top);
  const selectText = route.query.get("$select");
  if (route.query.has("$select")) {
    if (!selectText) throw new TypeError("$select cannot be empty");
    const selected = selectText.split(",").map((field) => field.trim());
    if (
      selected.some((field) => !field || !queryFieldSchema(route.entity, field)) ||
      new Set(selected).size !== selected.length
    ) {
      throw new TypeError("$select contains an undeclared or duplicate field");
    }
    result = result.map((record) => {
      const projected = {};
      for (const field of selected) projected[field] = record[field] ?? null;
      if (!selected.includes("@odata.etag")) projected["@odata.etag"] = record["@odata.etag"];
      return projected;
    });
  } else {
    result = result.map(clone);
  }
  const countRaw = route.query.get("$count");
  if (countRaw !== null && !["true", "false"].includes(countRaw)) {
    throw new TypeError("$count must be true or false");
  }
  return { records: result, count: countRaw === "true" ? total : null };
}

function expectedEdmProperty(entity, field) {
  if (field === ENTITY_DEFINITIONS[entity].id) {
    return { type: "Edm.Guid", nullable: false };
  }
  const runtimeType = ENTITY_DEFINITIONS[entity].fields[field];
  if (!runtimeType) return null;
  const nullable = runtimeType.endsWith("?");
  const base = nullable ? runtimeType.slice(0, -1) : runtimeType;
  const type = {
    boolean: "Edm.Boolean",
    datetime: "Edm.DateTimeOffset",
    decimal: "Edm.Decimal",
    entity: "Edm.String",
    guid: "Edm.Guid",
    integer: "Edm.Int32",
    integer64: "Edm.Int64",
    string: "Edm.String",
    url: "Edm.String",
  }[base];
  return type ? { type, nullable } : null;
}

function authoritativeMetadata(entities) {
  const entitySets = Object.entries(TENANT_SCHEMA.entities)
    .sort(([left], [right]) => codeUnitCompare(left, right))
    .map(([name, definition]) => {
      const properties = [];
      const navigationProperties = [];
      for (const [fieldName, field] of Object.entries(definition.fields).sort(
        ([left], [right]) => codeUnitCompare(left, right),
      )) {
        const property = {
          name: fieldName,
          type: field.edmType,
          nullable: field.nullable,
          mutable: field.mutable,
          readOnly: !field.mutable,
        };
        for (const attribute of [
          "scale",
          "options",
          "calculated",
          "minimum",
          "maximum",
          "discriminator",
          "formatted",
        ]) {
          if (Object.hasOwn(field, attribute)) {
            property[attribute] = clone(field[attribute]);
          }
        }
        if (field.lookup) {
          property.lookup = clone(field.lookup);
          navigationProperties.push({
            name: fieldName,
            targets: clone(field.lookup.targets),
            displayField: field.lookup.displayField,
            discriminator: field.lookup.discriminator ?? null,
            deletePolicy: field.lookup.onDelete,
          });
        }
        properties.push(property);
      }
      return {
        name,
        logicalName: definition.logicalName,
        entityType: definition.entityType,
        key: definition.key,
        primaryName: definition.primaryName,
        count: entities[name].length,
        mutable: definition.mutable,
        deletePolicy: definition.deletePolicy,
        appScopes: clone(definition.appScopes),
        properties,
        navigationProperties,
        statusPairs: clone(definition.statusPairs),
        activeStatusPairs: clone(definition.activeStatusPairs),
      };
    });
  return {
    "@odata.context": TENANT_CONFIG.metadata.context,
    namespace: TENANT_CONFIG.metadata.namespace,
    version: TENANT_CONFIG.metadata.version,
    schemaVersion: TENANT_CONFIG.metadata.schemaVersion,
    schemaDigest: TENANT_CONFIG.metadata.schemaDigest,
    compatibilityProfile: clone(TENANT_SCHEMA.compatibilityProfile),
    simulatorPolicies: clone(TENANT_SCHEMA.simulatorPolicies),
    apps: Object.values(TENANT_SCHEMA.apps).map(clone),
    actions: TENANT_SCHEMA.actions.map(clone),
    entitySets,
  };
}

function authoritativeFixtureChains(entities) {
  const find = (entity, predicate) => {
    const record = entities[entity].find(predicate);
    if (!record) throw new TypeError(`seed fixture anchor for ${entity} is missing`);
    return record;
  };
  const quote = find("quotes", (record) => record.quotenumber === "QUO-260100");
  const opportunity = find(
    "opportunities",
    (record) => record.opportunityid === quote.opportunityid,
  );
  const lead = find(
    "leads",
    (record) => record.leadid === opportunity.originatingleadid,
  );
  const order = find(
    "salesorders",
    (record) => record.quoteid === quote.quoteid,
  );
  const invoice = find(
    "invoices",
    (record) => record.salesorderid === order.salesorderid,
  );
  const invoiceLines = entities.invoicedetails.filter(
    (record) => record.invoiceid === invoice.invoiceid,
  );
  const productIds = new Set(invoiceLines.map((record) => record.productid));
  const assets = entities.msdyn_customerassets.filter(
    (record) =>
      record.msdyn_account === invoice.customerid &&
      productIds.has(record.msdyn_product),
  );

  const incident = find(
    "incidents",
    (record) => record.ticketnumber === "CAS-260102",
  );
  const workorder = find(
    "msdyn_workorders",
    (record) => record.msdyn_servicerequest === incident.incidentid,
  );
  const requirement = find(
    "msdyn_resourcerequirements",
    (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
  );
  const bookings = entities.bookableresourcebookings.filter(
    (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
  );
  return [
    {
      sourceKey: "anchor.sales.primary",
      lead: lead.leadid,
      opportunity: opportunity.opportunityid,
      quote: quote.quoteid,
      salesorder: order.salesorderid,
      invoice: invoice.invoiceid,
      invoicedetails: invoiceLines.map((record) => record.invoicedetailid),
      customerassets: assets.map((record) => record.msdyn_customerassetid),
    },
    {
      sourceKey: "anchor.field-service.primary",
      incident: incident.incidentid,
      customerasset: workorder.msdyn_customerasset,
      workorder: workorder.msdyn_workorderid,
      requirement: requirement.msdyn_resourcerequirementid,
      bookings: bookings.map((record) => record.bookableresourcebookingid),
      serviceTasks: entities.msdyn_workorderservicetasks
        .filter(
          (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
        )
        .map((record) => record.msdyn_workorderservicetaskid),
      products: entities.msdyn_workorderproducts
        .filter(
          (record) => record.msdyn_workorder === workorder.msdyn_workorderid,
        )
        .map((record) => record.msdyn_workorderproductid),
    },
  ];
}

function normalizeSeed(seed) {
  assertJsonValue(seed, "seed");
  if (seed?.schemaVersion === 2) {
    throw new TypeError(
      "seed schemaVersion 2 is not compatible with the standalone multi-app schemaVersion 3 runtime; replay it with the archived v2 runtime",
    );
  }
  if (
    !seed ||
    typeof seed !== "object" ||
    seed.schemaVersion !== TENANT_CONFIG.formatVersions.seed ||
    !seed.entities ||
    !seed.epoch ||
    !seed.identity ||
    !seed.metadata ||
    !seed.schema
  ) {
    throw new TypeError(
      "seed must use the generated schema version and include schema, identity, metadata, epoch, and entities",
    );
  }
  const normalized = clone(seed);
  const exactKeys = (value, expected, path) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort(codeUnitCompare).join("\0") !==
        [...expected].sort(codeUnitCompare).join("\0")
    ) {
      throw new TypeError(`${path} fields do not match the seed schema`);
    }
  };
  exactKeys(
    normalized,
    [
      "schemaVersion",
      "epoch",
      "tenant",
      "identities",
      "identity",
      "compatibilityProfile",
      "simulatorPolicies",
      "schemaDigest",
      "schema",
      "metadata",
      "fixtureChains",
      "entities",
    ],
    "seed",
  );
  exactKeys(
    normalized.tenant,
    ["name", "organizationUrl", "organizationVersion"],
    "seed tenant",
  );
  for (const field of ["name", "organizationUrl", "organizationVersion"]) {
    if (typeof normalized.tenant[field] !== "string" || !normalized.tenant[field]) {
      throw new TypeError(`seed tenant ${field} must be a non-empty string`);
    }
  }
  normalized.epoch = normalizeUtc(normalized.epoch, "seed epoch");
  if (
    normalized.epoch !== TENANT_CONFIG.epoch ||
    canonicalStringify(normalized.tenant) !==
      canonicalStringify(TENANT_CONFIG.tenant)
  ) {
    throw new TypeError("seed epoch or tenant differs from generated runtime configuration");
  }
  if (
    canonicalStringify(normalized.schema) !== canonicalStringify(TENANT_SCHEMA) ||
    normalized.schemaDigest !== TENANT_CONFIG.metadata.schemaDigest ||
    normalized.schemaVersion !== TENANT_SCHEMA.schemaVersion
  ) {
    throw new TypeError("seed schema or schema digest differs from the generated runtime schema");
  }
  if (
    canonicalStringify(normalized.compatibilityProfile) !==
      canonicalStringify(TENANT_SCHEMA.compatibilityProfile) ||
    canonicalStringify(normalized.simulatorPolicies) !==
      canonicalStringify(TENANT_SCHEMA.simulatorPolicies)
  ) {
    throw new TypeError("seed compatibility profile differs from the canonical schema");
  }
  if (!Array.isArray(normalized.identities) || !normalized.identities.length) {
    throw new TypeError("seed must include at least one identity");
  }
  const identityIds = new Set();
  for (const [index, identity] of normalized.identities.entries()) {
    exactKeys(identity, ["systemuserid", "fullname", "title"], `seed identity ${index}`);
    identity.systemuserid = normalizedRecordId(identity.systemuserid);
    if (
      !identity.fullname?.trim() ||
      !identity.title?.trim() ||
      identityIds.has(identity.systemuserid)
    ) {
      throw new TypeError(`seed identity ${index} is malformed or duplicated`);
    }
    identityIds.add(identity.systemuserid);
  }
  exactKeys(
    normalized.identity,
    [
      "@odata.context",
      "BusinessUnitId",
      "OrganizationId",
      "UserId",
      "FullName",
      "OrganizationUrl",
      "Version",
    ],
    "seed WhoAmI identity",
  );
  for (const field of ["BusinessUnitId", "OrganizationId", "UserId"]) {
    normalized.identity[field] = normalizedRecordId(normalized.identity[field]);
  }
  const entityNames = Object.keys(ENTITY_DEFINITIONS).sort(codeUnitCompare);
  if (
    Object.keys(normalized.entities).sort(codeUnitCompare).join("\0") !==
    entityNames.join("\0")
  ) {
    throw new TypeError("seed entity sets do not match the runtime schema");
  }
  const idsByEntity = {};
  const recordsByEntity = {};
  const allIds = new Set();
  for (const entity of entityNames) {
    const definition = ENTITY_DEFINITIONS[entity];
    const records = normalized.entities[entity];
    if (!Array.isArray(records)) throw new TypeError(`seed is missing ${entity}`);
    const ids = new Set();
    const byId = new Map();
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new TypeError(`seed ${entity} record must be an object`);
      }
      const allowed = new Set(["@odata.etag", ...Object.keys(definition.schema.fields)]);
      for (const [field, value] of Object.entries(record)) {
        if (field.includes("@OData.Community.Display.V1.FormattedValue")) {
          const base = field.split("@", 1)[0];
          if (!allowed.has(base) || typeof value !== "string") {
            throw new TypeError(`seed ${entity} annotation ${field} is invalid`);
          }
          continue;
        }
        if (!allowed.has(field)) {
          throw new TypeError(`seed ${entity} field ${field} is undeclared`);
        }
      }
      const id = normalizedRecordId(record[definition.id]);
      if (ids.has(id) || allIds.has(id)) {
        throw new TypeError(`seed has duplicate id ${id}`);
      }
      record[definition.id] = id;
      ids.add(id);
      allIds.add(id);
      byId.set(id, record);
      for (const [field, type] of Object.entries(definition.fields)) {
        if (record[field] === undefined) {
          if (!type.endsWith("?")) throw new TypeError(`seed ${entity}.${field} is required`);
          continue;
        }
        record[field] = validateFieldType(
          field,
          type,
          record[field],
          definition.schema.fields[field],
        );
        validateFieldConstraints(entity, field, record[field]);
      }
      validateRequiredFields(entity, record);
    }
    records.sort((a, b) => codeUnitCompare(a[definition.id], b[definition.id]));
    idsByEntity[entity] = ids;
    recordsByEntity[entity] = byId;
  }
  const resolveName = (entity, id) => {
    const record = recordsByEntity[entity]?.get(id);
    if (!record) throw new TypeError(`seed lookup ${entity}(${id}) does not resolve`);
    return record[ENTITY_DEFINITIONS[entity].primaryName];
  };
  for (const entity of entityNames) {
    const definition = ENTITY_DEFINITIONS[entity];
    for (const record of normalized.entities[entity]) {
      for (const [field, fieldSchema] of Object.entries(definition.schema.fields)) {
        const lookup = fieldSchema.lookup;
        if (!lookup || record[field] === null) continue;
        const target = lookup.discriminator
          ? record[lookup.discriminator]
          : lookup.targets[0];
        if (!lookup.targets.includes(target)) {
          throw new TypeError(`seed ${entity}.${field} lookup discriminator is invalid`);
        }
        const expectedName = resolveName(target, record[field]);
        if (
          record[lookup.displayField] !== expectedName ||
          record[`${field}@OData.Community.Display.V1.FormattedValue`] !== expectedName
        ) {
          throw new TypeError(`seed ${entity}.${field} has stale lookup display data`);
        }
      }
    }
  }
  const user = recordsByEntity.systemusers.get(normalized.identity.UserId);
  if (
    !user ||
    user.fullname !== normalized.identity.FullName ||
    user.businessunitid !== normalized.identity.BusinessUnitId ||
    normalized.identity.OrganizationUrl !== normalized.tenant.organizationUrl ||
    normalized.identity.Version !== normalized.tenant.organizationVersion ||
    normalized.identity["@odata.context"] !==
      `${normalized.tenant.organizationUrl}/api/data/v9.2/$metadata#Microsoft.Dynamics.CRM.WhoAmIResponse`
  ) {
    throw new TypeError("seed identity does not resolve to its user and business unit");
  }
  if (
    canonicalStringify(normalized.identity) !==
      canonicalStringify(TENANT_CONFIG.identity)
  ) {
    throw new TypeError("seed WhoAmI identity differs from generated runtime configuration");
  }
  for (const identity of normalized.identities) {
    const stored = recordsByEntity.systemusers.get(identity.systemuserid);
    if (
      !stored ||
      stored.fullname !== identity.fullname ||
      stored.title !== identity.title
    ) {
      throw new TypeError("seed identity list differs from stored system users");
    }
  }
  if (
    canonicalStringify(normalized.identities) !==
    canonicalStringify(TENANT_CONFIG.identities)
  ) {
    throw new TypeError("seed identities differ from generated runtime configuration");
  }
  const metadata = authoritativeMetadata(normalized.entities);
  if (
    canonicalStringify(normalized.metadata) !== canonicalStringify(metadata)
  ) {
    throw new TypeError("seed metadata differs from authoritative runtime metadata");
  }
  const fixtureChains = authoritativeFixtureChains(normalized.entities);
  if (
    canonicalStringify(normalized.fixtureChains) !==
    canonicalStringify(fixtureChains)
  ) {
    throw new TypeError("seed fixture chains differ from authoritative records");
  }
  normalized.schema = clone(TENANT_SCHEMA);
  normalized.schemaDigest = TENANT_CONFIG.metadata.schemaDigest;
  normalized.compatibilityProfile = clone(TENANT_SCHEMA.compatibilityProfile);
  normalized.simulatorPolicies = clone(TENANT_SCHEMA.simulatorPolicies);
  normalized.metadata = metadata;
  normalized.fixtureChains = fixtureChains;
  return normalized;
}


function cleanHeaders(headers) {
  return new TwinHeaders(headers).toObject();
}

function serializeRequest(input, init, logicalId, throwOnExhausted = false) {
  const headers = cleanHeaders(init.headers);
  headers["x-logical-request-id"] = logicalId;
  const serializedInit = {
    method: String(init.method || "GET").toUpperCase(),
    headers,
  };
  if (init.retry !== undefined) serializedInit.retry = clone(init.retry);
  const body =
    init.body === undefined
      ? { kind: "absent" }
      : typeof init.body === "string"
        ? { kind: "text", value: init.body }
        : { kind: "json", value: clone(init.body) };
  return {
    input: String(input),
    mode: throwOnExhausted ? "request" : "fetch",
    body,
    bodyFingerprint: sha256(canonicalStringify(body)),
    init: serializedInit,
  };
}

function deserializeRequest(request) {
  if (!request || typeof request.input !== "string" || !request.init) {
    throw new TypeError("recorded request is malformed");
  }
  if (
    request.bodyFingerprint !== undefined &&
    request.bodyFingerprint !== sha256(canonicalStringify(request.body))
  ) {
    throw new TypeError("recorded request body fingerprint does not match its representation");
  }
  const init = clone(request.init);
  if (request.body?.kind === "text") init.body = request.body.value;
  else if (request.body?.kind === "json") init.body = clone(request.body.value);
  else if (request.body?.kind !== "absent") {
    if (request.init.body !== undefined) init.body = request.init.body;
    else if (request.body !== undefined) throw new TypeError("recorded request body is malformed");
  }
  delete init.bodyRepresentation;
  return { input: request.input, init, mode: request.mode || "fetch" };
}

function responseSnapshot(response) {
  return {
    body: response.bodyText,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.toObject(),
  };
}

function restoreResponse(snapshot) {
  return new TwinResponse(snapshot.body, snapshot);
}

function errorSnapshot(error) {
  const snapshot = {
    name: String(error?.name || "Error"),
    message: String(error?.message || error),
  };
  if (error?.code !== undefined) snapshot.code = String(error.code);
  if (Number.isSafeInteger(error?.attempts)) snapshot.attempts = error.attempts;
  if (error?.response) snapshot.response = responseSnapshot(error.response);
  if (error?.cause) {
    snapshot.cause = {
      name: String(error.cause.name || "Error"),
      message: String(error.cause.message || error.cause),
    };
    if (error.cause.code !== undefined) snapshot.cause.code = String(error.cause.code);
  }
  return snapshot;
}

export class TwinCore {
  constructor(options = {}) {
    this.initialSeed = normalizeSeed(options.seed);
    this.seedDigest = sha256(canonicalStringify(this.initialSeed));
    this.clock = new VirtualClock(options.epoch || this.initialSeed.epoch);
    this.retryDefaults = {
      maxAttempts: options.retry?.maxAttempts ?? 1,
      baseDelayMs: options.retry?.baseDelayMs ?? 1000,
      maxDelayMs: options.retry?.maxDelayMs ?? 30000,
    };
    this.faultTemplate = clone(options.faults || []);
    this.trace = [];
    this.requestLog = [];
    this.runLog = [];
    this.automaticRequestCounter = 0n;
    this.usedLogicalRequestIds = new Set();
    this.revisionCounter = 0;
    this.creationCounter = 0;
    this.resetGeneration = 0;
    this._restoreSeed();
    this.validateIntegrity();
    this.setFaultPlan(this.faultTemplate, { record: false });
  }

  _restoreSeed() {
    this.entities = {};
    this.revisions = {};
    for (const [entity, sourceRecords] of Object.entries(this.initialSeed.entities)) {
      const idField = ENTITY_DEFINITIONS[entity].id;
      this.entities[entity] = new Map();
      this.revisions[entity] = new Map();
      for (const source of sourceRecords) {
        const record = clone(source);
        const id = record[idField];
        this.revisions[entity].set(id, 0);
        record["@odata.etag"] = recordEtag(record, 0, this.resetGeneration);
        this.entities[entity].set(id, record);
      }
    }
    this._rebuildReverseIndex();
    this.idempotency = new Map();
  }

  _rebuildReverseIndex() {
    this.reverseIndex = new Map();
    for (const [entity, definition] of Object.entries(ENTITY_DEFINITIONS)) {
      for (const record of this._records(entity)) {
        for (const [field, fieldSchema] of Object.entries(definition.schema.fields)) {
          const lookup = fieldSchema.lookup;
          const targetId = record[field];
          if (!lookup || targetId === null || targetId === undefined) continue;
          const targetEntity = lookup.discriminator
            ? record[lookup.discriminator]
            : lookup.targets[0];
          const indexKey = `${targetEntity}\0${targetId}`;
          const references = this.reverseIndex.get(indexKey) || [];
          references.push({
            sourceEntity: entity,
            sourceId: record[definition.id],
            field,
            displayField: lookup.displayField,
            onDelete: lookup.onDelete,
          });
          this.reverseIndex.set(indexKey, references);
        }
      }
    }
    for (const references of this.reverseIndex.values()) {
      references.sort((left, right) =>
        codeUnitCompare(
          `${left.sourceEntity}/${left.sourceId}/${left.field}`,
          `${right.sourceEntity}/${right.sourceId}/${right.field}`,
        ),
      );
    }
  }

  setFaultPlan(plans = [], options = {}) {
    if (!Array.isArray(plans)) throw new TypeError("fault plan must be an array");
    this.faults = plans.map((plan, index) => {
      if (!plan || typeof plan !== "object") throw new TypeError("fault entries must be objects");
      const allowed = new Set([
        "network",
        "timeout",
        "malformed",
        "http-429",
        "http-503",
        "post-commit-loss",
        "delay",
      ]);
      if (!allowed.has(plan.type)) throw new TypeError(`unsupported fault type: ${plan.type}`);
      const times = plan.times ?? 1;
      if (!Number.isSafeInteger(times) || times < 1) throw new TypeError("fault times must be positive");
      return { ...clone(plan), index, remaining: times };
    });
    if (options.record !== false) {
      this.runLog.push({ kind: "fault-plan", plans: clone(plans) });
    }
    this._event("fault-plan", { count: this.faults.length });
  }

  clearFaults(options = {}) {
    this.faults = [];
    if (options.record !== false) this.runLog.push({ kind: "clear-faults" });
    this._event("fault-plan", { count: 0 });
  }

  _event(kind, details = {}) {
    const event = {
      index: this.trace.length,
      at: this.clock.now(),
      kind,
      ...clone(details),
    };
    this.trace.push(event);
    return event;
  }

  _takeFault(context, phase) {
    for (const fault of this.faults) {
      if (fault.remaining <= 0) continue;
      const isPost = fault.type === "post-commit-loss";
      if ((phase === "post") !== isPost) continue;
      if (fault.attempt !== undefined && fault.attempt !== context.attempt) continue;
      if (fault.method && fault.method.toUpperCase() !== context.method) continue;
      if (fault.entity && fault.entity !== context.route.entity) continue;
      if (fault.pathIncludes && !context.route.pathname.includes(fault.pathIncludes)) continue;
      fault.remaining -= 1;
      this._event("fault", {
        fault: fault.type,
        faultIndex: fault.index,
        logicalRequestId: context.logicalId,
        attempt: context.attempt,
      });
      return fault;
    }
    return null;
  }

  _applyPreFault(fault, context) {
    if (!fault) return null;
    if (fault.type === "delay") {
      const delay = fault.delayMs ?? 1000;
      this.clock.advance(delay);
      this._event("delay", {
        milliseconds: delay,
        logicalRequestId: context.logicalId,
      });
      return null;
    }
    if (fault.type === "network") {
      throw new TwinTransportError("deterministic network failure", "ENETWORK");
    }
    if (fault.type === "timeout") {
      const delay = fault.delayMs ?? 30000;
      this.clock.advance(delay);
      throw new TwinTransportError("deterministic timeout", "ETIMEDOUT");
    }
    if (fault.type === "malformed") {
      return new TwinResponse("{malformed", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (fault.type === "http-429" || fault.type === "http-503") {
      const status = fault.type === "http-429" ? 429 : 503;
      const retryAfterMs = fault.retryAfterMs ?? 1000;
      return responseJson(
        {
          error: {
            code: status === 429 ? "0x80072323" : "0x80072F78",
            message: status === 429 ? "Too many requests." : "Service temporarily unavailable.",
          },
        },
        status,
        { "retry-after-ms": String(retryAfterMs) },
      );
    }
    return null;
  }

  _records(entity) {
    return [...this.entities[entity].values()].sort((left, right) =>
      codeUnitCompare(left[ENTITY_DEFINITIONS[entity].id], right[ENTITY_DEFINITIONS[entity].id]),
    );
  }

  _lookup(entity, id) {
    return this.entities[entity]?.get(id) || null;
  }

  _resolveName(entity, id) {
    const record = this._lookup(entity, id);
    if (!record) throw new TypeError(`${entity} lookup ${id} does not resolve`);
    return record[ENTITY_DEFINITIONS[entity].primaryName];
  }

  _identity(id = null) {
    const selectedId = id || this.initialSeed.identity.UserId;
    const selected = this._lookup("systemusers", selectedId);
    if (!selected) throw new TypeError(`system user lookup ${selectedId} does not resolve`);
    return selected;
  }

  _decorateLookups(entity, record) {
    const definition = ENTITY_DEFINITIONS[entity];
    if (entity === "contacts") {
      record.fullname = `${record.firstname} ${record.lastname}`.trim();
    }
    if (entity === "leads") {
      record.fullname = `${record.firstname} ${record.lastname}`.trim();
    }
    const formatted = (field, value) => {
      const annotation = `${field}@OData.Community.Display.V1.FormattedValue`;
      if (value === null || value === undefined) delete record[annotation];
      else record[annotation] = String(value);
    };
    for (const [field, fieldSchema] of Object.entries(definition.schema.fields)) {
      const lookup = fieldSchema.lookup;
      if (lookup) {
        if (record[field] === null || record[field] === undefined) {
          record[lookup.displayField] = null;
          formatted(field, null);
        } else {
          const target = lookup.discriminator
            ? record[lookup.discriminator]
            : lookup.targets[0];
          if (!lookup.targets.includes(target)) {
            throw new TypeError(`${entity}.${field} lookup discriminator is invalid`);
          }
          const name = this._resolveName(target, record[field]);
          record[lookup.displayField] = name;
          formatted(field, name);
        }
      }
      if (
        fieldSchema.options &&
        fieldSchema.formatted &&
        record[field] !== null &&
        record[field] !== undefined
      ) {
        const option = fieldSchema.options.find((item) => item.value === record[field]);
        if (!option) throw new TypeError(`${entity}.${field} option is invalid`);
        formatted(field, option.label);
      }
    }
    if (entity === "emails") {
      record.fromname = record.senderidname;
      record.toname = record.recipientidname;
    }
    return record;
  }

  _resolvePartyName(type, id) {
    if (!ENTITY_DEFINITIONS[type]) {
      throw new TypeError(`party type ${type} is not supported`);
    }
    return this._resolveName(type, id);
  }


  _defaults(entity, logicalId, payload = {}, internal = false) {
    const definition = ENTITY_DEFINITIONS[entity];
    if (!definition.mutable && !internal) throw new TypeError(`${entity} is read-only`);
    const owner = this._identity();
    const now = this.clock.now();
    const result = {};
    for (const [field, fieldSchema] of Object.entries(definition.schema.fields)) {
      if (field === definition.id) continue;
      if (fieldSchema.nullable) result[field] = null;
      if (fieldSchema.calculated) {
        if (fieldSchema.runtimeType === "decimal") {
          result[field] = decimalText(0n, fieldSchema.scale);
        } else if (fieldSchema.runtimeType === "integer") result[field] = 0;
        else if (fieldSchema.runtimeType === "boolean") result[field] = false;
        else if (fieldSchema.runtimeType === "string") result[field] = "";
      }
      if (fieldSchema.runtimeType === "decimal" && result[field] === undefined) {
        result[field] = decimalText(0n, fieldSchema.scale);
      }
      if (fieldSchema.runtimeType === "boolean" && result[field] === undefined) {
        result[field] = false;
      }
      if (fieldSchema.options && result[field] === undefined) {
        result[field] = fieldSchema.options[0].value;
      }
      if (
        fieldSchema.runtimeType === "integer" &&
        result[field] === undefined &&
        fieldSchema.minimum !== undefined
      ) {
        result[field] = fieldSchema.minimum;
      }
    }
    if (definition.schema.fields.ownerid) {
      result.ownerid = owner.systemuserid;
      result.owneridname = owner.fullname;
    }
    if (definition.schema.fields.createdon) result.createdon = now;
    if (definition.schema.fields.modifiedon) result.modifiedon = now;
    if (definition.statePairs.length) {
      const [statecode, statuscode] = definition.statePairs[0].split(":").map(Number);
      result.statecode = statecode;
      result.statuscode = statuscode;
    }
    const currency = this._records("transactioncurrencies").find(
      (record) => record.isocurrencycode === "USD" && record.statecode === 0,
    );
    if (definition.schema.fields.transactioncurrencyid && currency) {
      result.transactioncurrencyid = currency.transactioncurrencyid;
      result.transactioncurrencyidname = currency.currencyname;
    }
    const sequence = String(
      Number.parseInt(sha256(logicalId).slice(0, 8), 16) % 100000,
    ).padStart(5, "0");
    if (entity === "accounts") result.accountnumber = `AST-R${sequence}`;
    if (entity === "contacts") result.preferredcontactmethodcode = 2;
    if (entity === "incidents") {
      Object.assign(result, {
        ticketnumber: `CAS-R${sequence}`,
        prioritycode: 2,
        caseorigincode: 2,
        casetypecode: 3,
        statecode: 0,
        statuscode: 1,
        resolveby: new Date(this.clock.valueOf() + 6 * 86400000).toISOString(),
        firstresponsesenton: null,
        resolvedon: null,
      });
    }
    if (entity === "tasks") {
      Object.assign(result, {
        regardingobjectidtype: "incidents",
        prioritycode: 2,
        percentcomplete: 0,
        actualend: null,
        statecode: 0,
        statuscode: 2,
      });
    }
    if (entity === "emails") {
      const direction = payload.directioncode ?? result.directioncode;
      const rule = EMAIL_DIRECTION_RULES[String(direction)];
      Object.assign(result, {
        directioncode: direction,
        regardingobjectidtype: "incidents",
        scheduledstart: now,
        senton: now,
        statecode: rule.statecode,
        statuscode: rule.statuscode,
      });
    }
    if (entity === "connections") {
      Object.assign(result, {
        connectionpairid: deterministicGuid(`${this.seedDigest}/${logicalId}/pair`),
        record1roleidname: null,
        record2roleidname: null,
        description: null,
        effectivestart: now,
        effectiveend: null,
        statecode: 0,
        statuscode: 1,
      });
    }
    const generatedNumbers = {
      leads: ["fullname", ""],
      quotes: ["quotenumber", `QUO-R${sequence}`],
      salesorders: ["ordernumber", `ORD-R${sequence}`],
      invoices: ["invoicenumber", `INV-R${sequence}`],
      msdyn_workorders: ["msdyn_name", `WO-R${sequence}`],
    };
    if (generatedNumbers[entity]) {
      result[generatedNumbers[entity][0]] = generatedNumbers[entity][1];
    }
    if (entity === "quotes") result.revisionnumber = 1;
    if (["quotedetails", "opportunityproducts", "salesorderdetails", "invoicedetails"].includes(entity)) {
      result.lineitemnumber = 1;
      if (definition.schema.fields.ispriceoverridden) result.ispriceoverridden = false;
      if (definition.schema.fields.quantityshipped) result.quantityshipped = "0.00";
      if (definition.schema.fields.quantitycancelled) result.quantitycancelled = "0.00";
    }
    if (entity === "bookableresourcebookings") result.duration = 1;
    if (entity === "msdyn_workorderproducts") {
      result.msdyn_lineorder = 1;
      result.msdyn_totalamount = "0.00";
    }
    if (entity === "msdyn_workorderservices") result.msdyn_totalamount = "0.00";
    return result;
  }


  _ensureEmailParties(record, synthesize = false) {
    const owner = this._identity(record.ownerid);
    const rule = EMAIL_DIRECTION_RULES[String(record.directioncode)];
    if (synthesize && rule) {
      const contact = this._records("contacts")[0];
      if (!contact) throw new TypeError("email party defaults require at least one contact");
      if (!record.senderid) {
        record.senderid =
          rule.senderType === "systemusers" ? owner.systemuserid : contact.contactid;
      }
      if (!record.senderidtype) record.senderidtype = rule.senderType;
      if (!record.recipientid) {
        record.recipientid =
          rule.recipientType === "systemusers" ? owner.systemuserid : contact.contactid;
      }
      if (!record.recipientidtype) record.recipientidtype = rule.recipientType;
    }
    record.fromname = this._resolvePartyName(record.senderidtype, record.senderid);
    record.toname = this._resolvePartyName(record.recipientidtype, record.recipientid);
  }

  _validateLookups(entity, record) {
    for (const [field, allowed] of Object.entries(ENTITY_DEFINITIONS[entity].discriminators)) {
      if (!allowed.includes(record[field])) {
        throw new TypeError(`${field} must be one of ${allowed.join(", ")}`);
      }
    }
    this._decorateLookups(entity, record);
    if (entity === "connections" && record.record1id === record.record2id) {
      throw new TypeError("a connection cannot relate a record to itself");
    }
  }

  _assertRecordWritable(entity, current, payload = {}, operation = "update") {
    const definition = ENTITY_DEFINITIONS[entity];
    if (!definition.mutable) throw new TypeError(`${entity} is read-only`);
    if (
      operation === "create" &&
      ["msdyn_workorders", "bookableresourcebookings"].includes(entity)
    ) {
      throw new TypeError(
        `${entity} creation requires its registered atomic action`,
      );
    }
    if (CLOSED_HEADER_ENTITIES.has(entity) && current && current.statecode !== 0) {
      throw new TypeError(`closed ${definition.logicalName} records are read-only`);
    }
    const lineContract = SALES_LINE_CONTRACTS[entity];
    if (lineContract) {
      const parentId =
        current?.[lineContract.parentField] ?? payload[lineContract.parentField];
      const parent = this._lookup(lineContract.parentEntity, parentId);
      if (!parent) throw new TypeError(`${lineContract.parentField} does not resolve`);
      if (parent.statecode !== 0) {
        throw new TypeError(`lines of closed ${lineContract.parentEntity} are read-only`);
      }
      if (
        current &&
        payload[lineContract.parentField] !== undefined &&
        payload[lineContract.parentField] !== current[lineContract.parentField]
      ) {
        throw new TypeError("sales lines cannot be moved to a different parent");
      }
    }
    if (
      ["leads", "opportunities", "quotes", "salesorders", "invoices"].includes(entity) &&
      (payload.statecode !== undefined || payload.statuscode !== undefined)
    ) {
      throw new TypeError(`${entity} lifecycle changes require a registered action`);
    }
    if (
      current &&
      ["opportunities", "quotes", "salesorders", "invoices"].includes(entity) &&
      (payload.transactioncurrencyid !== undefined ||
        payload.pricelevelid !== undefined)
    ) {
      const contractEntry = Object.entries(SALES_LINE_CONTRACTS).find(
        ([, contract]) => contract.parentEntity === entity,
      );
      if (contractEntry) {
        const [lineEntity, contract] = contractEntry;
        const hasLines = this._records(lineEntity).some(
          (line) =>
            line[contract.parentField] === current[definition.id],
        );
        const currencyChanged =
          payload.transactioncurrencyid !== undefined &&
          payload.transactioncurrencyid !== current.transactioncurrencyid;
        const priceListChanged =
          payload.pricelevelid !== undefined &&
          payload.pricelevelid !== current.pricelevelid;
        if (hasLines && (currencyChanged || priceListChanged)) {
          throw new TypeError(
            "document currency and price list cannot change while lines exist",
          );
        }
      }
    }
    if (entity === "msdyn_workorders") {
      if ([690970003, 690970004, 690970005].includes(current?.msdyn_systemstatus)) {
        throw new TypeError("terminal work orders are read-only");
      }
      if (
        payload.msdyn_systemstatus !== undefined ||
        payload.statecode !== undefined ||
        payload.statuscode !== undefined
      ) {
        throw new TypeError("work order lifecycle changes require a registered action");
      }
    }
    if (
      entity === "bookableresourcebookings" &&
      current?.statecode === 1 &&
      operation !== "action"
    ) {
      throw new TypeError("terminal bookings are read-only");
    }
    if (
      entity === "bookableresourcebookings" &&
      operation !== "action" &&
      (payload.bookingstatus !== undefined ||
        payload.statecode !== undefined ||
        payload.statuscode !== undefined)
    ) {
      throw new TypeError("booking lifecycle changes require a registered action");
    }
    if (WORK_ORDER_CHILD_ENTITIES.has(entity) && operation !== "action") {
      const parentId = current?.msdyn_workorder ?? payload.msdyn_workorder;
      const parent = this._lookup("msdyn_workorders", parentId);
      if (!parent) throw new TypeError("work order child parent does not resolve");
      if (
        current &&
        payload.msdyn_workorder !== undefined &&
        payload.msdyn_workorder !== current.msdyn_workorder
      ) {
        throw new TypeError("work order children cannot move to a different parent");
      }
      if (
        parent.statecode !== 0 ||
        TERMINAL_WORK_ORDER_STATUSES.has(parent.msdyn_systemstatus)
      ) {
        throw new TypeError("children of terminal work orders are read-only");
      }
    }
  }

  _prepareDerived(entity, record, payload = {}, current = null) {
    if (
      entity === "transactioncurrencies" &&
      decimalUnits(record.exchangerate, 6) <= 0n
    ) {
      throw new TypeError("transaction currency exchange rate must be positive");
    }
    if (
      entity !== "transactioncurrencies" &&
      ENTITY_DEFINITIONS[entity].schema.fields.exchangerate
    ) {
      const currency = this._lookup(
        "transactioncurrencies",
        record.transactioncurrencyid,
      );
      if (!currency || decimalUnits(currency.exchangerate, 6) <= 0n) {
        throw new TypeError("transaction currency must have a positive exchange rate");
      }
      record.exchangerate = currency.exchangerate;
    }
    if (entity === "products") {
      const unit = this._lookup("uoms", record.defaultuomid);
      if (!unit) throw new TypeError("product default UOM does not resolve");
      if (
        payload.defaultuomscheduleid !== undefined &&
        payload.defaultuomscheduleid !== unit.uomscheduleid
      ) {
        throw new TypeError("product default UOM must belong to its unit group");
      }
      record.defaultuomscheduleid = unit.uomscheduleid;
    }
    const lineContract = SALES_LINE_CONTRACTS[entity];
    if (lineContract) {
      const parent = this._lookup(
        lineContract.parentEntity,
        record[lineContract.parentField],
      );
      if (!parent) throw new TypeError(`${lineContract.parentField} does not resolve`);
      if (!current && payload.transactioncurrencyid === undefined) {
        record.transactioncurrencyid = parent.transactioncurrencyid;
        record.exchangerate = parent.exchangerate;
      }
      if (record.transactioncurrencyid !== parent.transactioncurrencyid) {
        throw new TypeError("sales line currency must match its parent");
      }
      const priceList = this._lookup("pricelevels", parent.pricelevelid);
      const currency = this._lookup(
        "transactioncurrencies",
        parent.transactioncurrencyid,
      );
      if (
        !priceList ||
        priceList.statecode !== 0 ||
        !currency ||
        currency.statecode !== 0 ||
        priceList.transactioncurrencyid !== parent.transactioncurrencyid
      ) {
        throw new TypeError("sales line parent requires an active coherent price list");
      }
      if (decimalUnits(record.quantity, 2) <= 0n) {
        throw new TypeError("line quantity must be greater than zero");
      }
      const shouldResolveCurrentPrice =
        (!current && payload.priceperunit === undefined) ||
        (entity === "opportunityproducts" && record.ispriceoverridden === false);
      if (shouldResolveCurrentPrice) {
        const price = this._records("productpricelevels").find(
          (candidate) =>
            candidate.productid === record.productid &&
            candidate.pricelevelid === parent.pricelevelid &&
            candidate.uomid === record.uomid &&
            candidate.transactioncurrencyid === parent.transactioncurrencyid,
        );
        if (!price) throw new TypeError("no active product price exists for the parent price list");
        record.priceperunit = price.amount;
      }
      const coherentPrice = this._records("productpricelevels").some(
        (candidate) =>
          candidate.productid === record.productid &&
          candidate.pricelevelid === parent.pricelevelid &&
          candidate.uomid === record.uomid &&
          candidate.transactioncurrencyid === parent.transactioncurrencyid,
      );
      if (!coherentPrice) {
        throw new TypeError("sales line has no coherent product price level");
      }
      record.baseamount = multiplyDecimal(record.quantity, 2, record.priceperunit, 2);
      const extended =
        decimalUnits(record.baseamount, 2) -
        decimalUnits(record.manualdiscountamount, 2) +
        decimalUnits(record.tax, 2);
      if (
        decimalUnits(record.manualdiscountamount, 2) < 0n ||
        decimalUnits(record.tax, 2) < 0n ||
        extended < 0n
      ) {
        throw new TypeError("line discounts, tax, and extended amount must be non-negative");
      }
      record.extendedamount = decimalText(extended, 2);
      if (!current) {
        const siblingNumbers = this._records(entity)
          .filter(
            (candidate) =>
              candidate[lineContract.parentField] === record[lineContract.parentField],
          )
          .map((candidate) => candidate.lineitemnumber);
        record.lineitemnumber = (siblingNumbers.length ? Math.max(...siblingNumbers) : 0) + 1;
      }
    }
    if (["quotes", "salesorders", "invoices", "opportunities"].includes(entity)) {
      const priceList = this._lookup("pricelevels", record.pricelevelid);
      if (
        !current &&
        payload.transactioncurrencyid === undefined &&
        priceList
      ) {
        record.transactioncurrencyid = priceList.transactioncurrencyid;
        const currency = this._lookup(
          "transactioncurrencies",
          record.transactioncurrencyid,
        );
        record.exchangerate = currency?.exchangerate;
      }
      const currency = this._lookup(
        "transactioncurrencies",
        record.transactioncurrencyid,
      );
      if (
        !priceList ||
        priceList.statecode !== 0 ||
        !currency ||
        currency.statecode !== 0 ||
        decimalUnits(currency.exchangerate, 6) <= 0n ||
        priceList.transactioncurrencyid !== record.transactioncurrencyid
      ) {
        throw new TypeError("document requires an active coherent price list and currency");
      }
      const contractEntry = Object.entries(SALES_LINE_CONTRACTS).find(
        ([, contract]) => contract.parentEntity === entity,
      );
      if (contractEntry && record[ENTITY_DEFINITIONS[entity].id]) {
        const [lineEntity, contract] = contractEntry;
        const lines = this._records(lineEntity).filter(
          (line) =>
            line[contract.parentField] ===
            record[ENTITY_DEFINITIONS[entity].id],
        );
        let base = 0n;
        let discount = 0n;
        let tax = 0n;
        for (const line of lines) {
          base += decimalUnits(line.baseamount, 2);
          discount += decimalUnits(line.manualdiscountamount, 2);
          tax += decimalUnits(line.tax, 2);
        }
        const headerDiscount = record.discountamount
          ? decimalUnits(record.discountamount, 2)
          : 0n;
        const freight = record.freightamount
          ? decimalUnits(record.freightamount, 2)
          : 0n;
        record.totallineitemamount = decimalText(base, 2);
        record.totaldiscountamount = decimalText(
          discount + headerDiscount,
          2,
        );
        record.totaltax = decimalText(tax, 2);
        const total = base - discount - headerDiscount + tax + freight;
        if (
          minBigInt(base, discount, headerDiscount, tax, freight, total) < 0n
        ) {
          throw new TypeError("document money and derived totals must be non-negative");
        }
        record.totalamount = decimalText(total, 2);
      }
    }
    if (entity === "productpricelevels") {
      const priceList = this._lookup("pricelevels", record.pricelevelid);
      const product = this._lookup("products", record.productid);
      const unit = this._lookup("uoms", record.uomid);
      if (
        !priceList ||
        priceList.transactioncurrencyid !== record.transactioncurrencyid ||
        !product ||
        !unit ||
        unit.uomscheduleid !== product.defaultuomscheduleid
      ) {
        throw new TypeError("product price currency and UOM must match its catalog");
      }
    }
    if (entity === "msdyn_workorderproducts") {
      if (decimalUnits(record.msdyn_quantity, 2) <= 0n) {
        throw new TypeError("work order product quantity must be positive");
      }
      record.msdyn_totalamount = multiplyDecimal(
        record.msdyn_quantity,
        2,
        record.msdyn_unitamount,
        2,
      );
      const product = this._lookup("products", record.msdyn_product);
      const unit = this._lookup("uoms", record.msdyn_unit);
      if (!product || !unit || unit.uomscheduleid !== product.defaultuomscheduleid) {
        throw new TypeError("work order product unit is outside its product unit group");
      }
      if (!current) {
        const lines = this._records(entity).filter(
          (candidate) => candidate.msdyn_workorder === record.msdyn_workorder,
        );
        record.msdyn_lineorder =
          (lines.length ? Math.max(...lines.map((line) => line.msdyn_lineorder)) : 0) + 1;
      }
    }
    if (entity === "msdyn_workorderservices") {
      record.msdyn_totalamount = record.msdyn_unitamount;
    }
    if (entity === "msdyn_resourcerequirements") {
      const start = new Date(record.msdyn_fromdate).valueOf();
      const end = new Date(record.msdyn_todate).valueOf();
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) {
        throw new TypeError("resource requirement must have a positive UTC window");
      }
    }
    if (entity === "bookableresourcebookings") {
      const start = new Date(record.starttime).valueOf();
      const end = new Date(record.endtime).valueOf();
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) {
        throw new TypeError("booking must have a positive UTC interval");
      }
      const duration = (end - start) / 60000;
      if (!Number.isSafeInteger(duration) || duration < 1) {
        throw new TypeError("booking duration must be a whole number of minutes");
      }
      record.duration = duration;
      const requirement = this._lookup(
        "msdyn_resourcerequirements",
        record.msdyn_resourcerequirement,
      );
      if (!requirement || requirement.msdyn_workorder !== record.msdyn_workorder) {
        throw new TypeError("booking requirement must belong to its work order");
      }
      const requirementStart = new Date(requirement.msdyn_fromdate).valueOf();
      const requirementEnd = new Date(requirement.msdyn_todate).valueOf();
      if (start < requirementStart || end > requirementEnd) {
        throw new TypeError("booking must be contained in its requirement window");
      }
      const resource = this._lookup("bookableresources", record.resource);
      if (!resource || resource.statecode !== 0) {
        throw new TypeError("booking requires an active resource");
      }
      if (record.statecode === 0 && requirement.statecode !== 0) {
        throw new TypeError("active booking requires an active requirement");
      }
      const status = this._lookup("bookingstatuses", record.bookingstatus);
      const canceled = status?.msdyn_fieldservicestatus === 690970004;
      if (!canceled) {
        for (const candidate of this._records("bookableresourcebookings")) {
          if (
            candidate.bookableresourcebookingid ===
              current?.bookableresourcebookingid ||
            candidate.resource !== record.resource
          ) {
            continue;
          }
          const candidateStatus = this._lookup(
            "bookingstatuses",
            candidate.bookingstatus,
          );
          if (candidateStatus?.msdyn_fieldservicestatus === 690970004) continue;
          const candidateStart = new Date(candidate.starttime).valueOf();
          const candidateEnd = new Date(candidate.endtime).valueOf();
          if (start < candidateEnd && candidateStart < end) {
            throw new TypeError("resource booking overlaps an existing half-open interval");
          }
        }
      }
    }
    if (entity === "msdyn_workorders") {
      const asset = this._lookup("msdyn_customerassets", record.msdyn_customerasset);
      const incident = this._lookup("incidents", record.msdyn_servicerequest);
      const caseAccount =
        incident?.customeridtype === "accounts"
          ? incident.customerid
          : this._lookup("contacts", incident?.customerid)?.parentcustomerid;
      if (
        !asset ||
        !incident ||
        record.msdyn_serviceaccount !== asset.msdyn_account ||
        record.msdyn_serviceaccount !== caseAccount
      ) {
        throw new TypeError("work order case, asset, and service account must agree");
      }
    }
    return record;
  }

  _lineRollupChange(entity, nextLine, currentLine = null, deleting = false) {
    const contract = SALES_LINE_CONTRACTS[entity];
    if (!contract) return null;
    const parentId = (nextLine || currentLine)[contract.parentField];
    const parent = this._lookup(contract.parentEntity, parentId);
    if (!parent) throw new TypeError("sales line parent does not resolve");
    const lineId = currentLine?.[ENTITY_DEFINITIONS[entity].id];
    const lines = this._records(entity)
      .filter((line) => line[contract.parentField] === parentId)
      .filter((line) => line[ENTITY_DEFINITIONS[entity].id] !== lineId);
    if (!deleting && nextLine) lines.push(nextLine);
    let base = 0n;
    let discount = 0n;
    let tax = 0n;
    for (const line of lines) {
      base += decimalUnits(line.baseamount, 2);
      discount += decimalUnits(line.manualdiscountamount, 2);
      tax += decimalUnits(line.tax, 2);
    }
    const headerDiscount = parent.discountamount
      ? decimalUnits(parent.discountamount, 2)
      : 0n;
    const freight = parent.freightamount
      ? decimalUnits(parent.freightamount, 2)
      : 0n;
    const updated = clone(parent);
    updated.totallineitemamount = decimalText(base, 2);
    updated.totaldiscountamount = decimalText(discount + headerDiscount, 2);
    updated.totaltax = decimalText(tax, 2);
    const total = base - discount - headerDiscount + tax + freight;
    if (
      minBigInt(base, discount, headerDiscount, tax, freight, total) < 0n
    ) {
      throw new TypeError("document money and derived totals must be non-negative");
    }
    updated.totalamount = decimalText(total, 2);
    return {
      entity: contract.parentEntity,
      id: parentId,
      record: updated,
      kind: "line-rollup",
      before: parent,
    };
  }

  _commitBatch(changes, logicalId) {
    let nextRevision = this.revisionCounter;
    const seenChanges = new Set();
    const prepared = changes.map((change) => {
      if (!ENTITY_DEFINITIONS[change.entity]) {
        throw new TypeError(`unknown staged entity ${change.entity}`);
      }
      const changeKey = `${change.entity}\0${change.id}`;
      if (seenChanges.has(changeKey)) {
        throw new TypeError(`duplicate staged change for ${change.entity}(${change.id})`);
      }
      seenChanges.add(changeKey);
      nextRevision += 1;
      const record = change.record ? clone(change.record) : null;
      if (record) {
        record.modifiedon = this.clock.now();
        record["@odata.etag"] = recordEtag(record, nextRevision, this.resetGeneration);
      }
      const event = {
        operation: change.kind,
        entity: change.entity,
        id: change.id,
        revision: nextRevision,
        logicalRequestId: logicalId,
        beforeDigest: change.before ? sha256(canonicalStringify(change.before)) : null,
        afterDigest: record ? sha256(canonicalStringify(record)) : null,
      };
      return { ...change, record, revision: nextRevision, event };
    });
    const previousEntities = this.entities;
    const previousRevisions = this.revisions;
    const previousReverseIndex = this.reverseIndex;
    const projectedEntities = {};
    const projectedRevisions = {};
    for (const entity of Object.keys(ENTITY_DEFINITIONS)) {
      projectedEntities[entity] = new Map(previousEntities[entity]);
      projectedRevisions[entity] = new Map(previousRevisions[entity]);
    }
    for (const change of prepared) {
      if (change.record) {
        projectedEntities[change.entity].set(change.id, change.record);
        projectedRevisions[change.entity].set(change.id, change.revision);
      } else {
        projectedEntities[change.entity].delete(change.id);
        projectedRevisions[change.entity].delete(change.id);
      }
    }
    this.entities = projectedEntities;
    this.revisions = projectedRevisions;
    try {
      this._rebuildReverseIndex();
      this.validateIntegrity();
    } finally {
      this.entities = previousEntities;
      this.revisions = previousRevisions;
      this.reverseIndex = previousReverseIndex;
    }
    for (const change of prepared) {
      if (change.record) {
        this.entities[change.entity].set(change.id, change.record);
        this.revisions[change.entity].set(change.id, change.revision);
      } else {
        this.entities[change.entity].delete(change.id);
        this.revisions[change.entity].delete(change.id);
      }
    }
    this.revisionCounter = nextRevision;
    this._rebuildReverseIndex();
    for (const change of prepared) this._event("commit", change.event);
    return prepared;
  }

  _commit(entity, id, record, kind, logicalId, before = null) {
    return this._commitBatch(
      [{ entity, id, record, kind, before }],
      logicalId,
    )[0].record;
  }

  _namePropagationChanges(entity, id, updated) {
    const primaryName = ENTITY_DEFINITIONS[entity].primaryName;
    const name = updated[primaryName];
    const references = this.reverseIndex.get(`${entity}\0${id}`) || [];
    const changes = [];
    const staged = new Map();
    for (const reference of references) {
      if (reference.sourceEntity === entity && reference.sourceId === id) continue;
      const key = `${reference.sourceEntity}\0${reference.sourceId}`;
      const current = this._lookup(reference.sourceEntity, reference.sourceId);
      if (!current) continue;
      const next = staged.get(key)?.record || clone(current);
      next[reference.displayField] = name;
      next[`${reference.field}@OData.Community.Display.V1.FormattedValue`] = name;
      if (reference.sourceEntity === "emails" && reference.field === "senderid") {
        next.fromname = name;
      }
      if (reference.sourceEntity === "emails" && reference.field === "recipientid") {
        next.toname = name;
      }
      staged.set(key, { reference, current, record: next });
    }
    for (const { reference, current, record } of staged.values()) {
      changes.push({
        entity: reference.sourceEntity,
        id: reference.sourceId,
        record,
        kind: "cascade-update",
        before: current,
      });
    }
    return changes;
  }


  _ifMatch(record, headers) {
    const supplied = headers.get("if-match");
    if (!supplied || supplied === "*") return null;
    if (supplied !== record["@odata.etag"]) {
      return errorResponse(
        412,
        "0x80060882",
        "The record was changed by another client. Refresh and retry with the current ETag.",
      );
    }
    return null;
  }

  _deleteGuard(entity, id) {
    return (this.reverseIndex.get(`${entity}\0${id}`) || [])
      .filter((reference) => reference.onDelete === "restrict")
      .map(
        (reference) =>
          `${reference.sourceEntity}(${reference.sourceId}).${reference.field}`,
      )
      .sort(codeUnitCompare);
  }


  _handleDeleteMany(route, init, logicalId) {
    if (!["accounts", "contacts"].includes(route.entity)) {
      return errorResponse(405, "0x80060888", "Atomic bulk delete supports accounts and contacts.");
    }
    if ([...route.query.keys()].length) {
      return errorResponse(400, "0x80060888", "Atomic bulk delete does not accept query options.");
    }
    let payload;
    try {
      payload = parseBody(init.body);
      if (
        Object.keys(payload).sort(codeUnitCompare).join(",") !== "records" ||
        !Array.isArray(payload.records) ||
        payload.records.length === 0
      ) {
        throw new TypeError("atomic bulk delete requires a non-empty records array");
      }
      const seen = new Set();
      const selected = payload.records.map((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          Object.keys(entry).sort(codeUnitCompare).join(",") !== "etag,id" ||
          typeof entry.etag !== "string" ||
          !entry.etag
        ) {
          throw new TypeError("each bulk delete record requires only id and etag");
        }
        const id = normalizedRecordId(entry.id);
        if (seen.has(id)) throw new TypeError("bulk delete record ids must be unique");
        seen.add(id);
        return { id, etag: entry.etag };
      });
      const records = [];
      for (const selection of selected) {
        const current = this._lookup(route.entity, selection.id);
        if (!current) {
          return errorResponse(404, "0x80040217", "A selected record was not found.");
        }
        const precondition = this._ifMatch(
          current,
          new TwinHeaders({ "if-match": selection.etag }),
        );
        if (precondition) return precondition;
        records.push(current);
      }
      const blocked = records
        .map((record) => ({
          id: record[ENTITY_DEFINITIONS[route.entity].id],
          references: this._deleteGuard(
            route.entity,
            record[ENTITY_DEFINITIONS[route.entity].id],
          ),
        }))
        .filter((item) => item.references.length);
      if (blocked.length) {
        return errorResponse(
          409,
          "0x80040265",
          `Atomic bulk delete blocked; ${blocked.length} selected record(s) have related data.`,
        );
      }
      this._commitBatch(
        records.map((record) => ({
          entity: route.entity,
          id: record[ENTITY_DEFINITIONS[route.entity].id],
          record: null,
          kind: "delete",
          before: record,
        })),
        logicalId,
      );
      return responseJson({ deleted: records.length }, 200);
    } catch (error) {
      return errorResponse(400, "0x80060888", error.message);
    }
  }

  _metadata() {
    return authoritativeMetadata(
      Object.fromEntries(
        Object.keys(ENTITY_DEFINITIONS).map((entity) => [
          entity,
          this._records(entity),
        ]),
      ),
    );
  }

  _whoAmI() {
    return clone(this.initialSeed.identity);
  }

  _handleGet(route) {
    if (["whoami", "metadata", "root"].includes(route.kind) && [...route.query.keys()].length) {
      return errorResponse(400, "0x80060888", "This resource does not accept query options.");
    }
    if (route.kind === "whoami") return responseJson(this._whoAmI());
    if (route.kind === "metadata") return responseJson(this._metadata());
    if (route.kind === "root") {
      return responseJson({
        value: Object.keys(ENTITY_DEFINITIONS)
          .sort(codeUnitCompare)
          .map((name) => ({ name, kind: "EntitySet", url: name })),
      });
    }
    const definition = ENTITY_DEFINITIONS[route.entity];
    if (!definition) return errorResponse(404, "0x80060888", "Resource not found.");
    if (route.kind === "record") {
      if ([...route.query.keys()].some((key) => key !== "$select")) {
        return errorResponse(400, "0x80060888", "Unsupported record query option.");
      }
      const record = this._lookup(route.entity, route.id);
      if (!record) return errorResponse(404, "0x80040217", "The requested record was not found.");
      try {
        const projected = applyQuery([record], {
          ...route,
          query: route.query,
        }).records[0];
        return responseJson(projected, 200, { etag: record["@odata.etag"] });
      } catch (error) {
        return errorResponse(400, "0x80060888", error.message);
      }
    }
    try {
      const result = applyQuery(this._records(route.entity), route);
      const envelope = {
        "@odata.context": `${this.initialSeed.tenant.organizationUrl}/api/data/v9.2/$metadata#${route.entity}`,
        value: result.records,
      };
      if (result.count !== null) envelope["@odata.count"] = result.count;
      return responseJson(envelope);
    } catch (error) {
      return errorResponse(400, "0x80060888", error.message);
    }
  }

  _actionTargetId(route, payload, names) {
    if (route.id) {
      for (const name of names) {
        if (
          payload[name] !== undefined &&
          normalizedRecordId(payload[name]) !== route.id
        ) {
          throw new TypeError(
            `${route.action} payload target differs from its binding`,
          );
        }
      }
      return route.id;
    }
    for (const name of names) {
      if (payload[name] !== undefined && payload[name] !== null) {
        return normalizedRecordId(payload[name]);
      }
    }
    throw new TypeError(`${route.action} requires ${names[0]}`);
  }

  _actionCurrent(route, payload, entity, names, headers) {
    const id = this._actionTargetId(route, payload, names);
    if (route.id && route.entity !== entity) {
      throw new TypeError(`${route.action} cannot be bound to ${route.entity}`);
    }
    const record = this._lookup(entity, id);
    if (!record) throw new TypeError(`${entity}(${id}) was not found`);
    const precondition = this._ifMatch(record, headers);
    return { id, record, precondition };
  }

  _newActionRecord(entity, logicalId, suffix, values = {}) {
    const id = deterministicGuid(
      `${this.seedDigest}/${logicalId}/${entity}/${suffix}`,
    );
    if (this._lookup(entity, id)) {
      throw new TypeError(`deterministic ${entity} action id already exists`);
    }
    const record = {
      ...this._defaults(entity, `${logicalId}-${suffix}`, values, true),
      ...values,
      [ENTITY_DEFINITIONS[entity].id]: id,
    };
    return record;
  }

  _decorateStagedChanges(changes) {
    const staged = new Map();
    for (const change of changes) {
      if (change.record) {
        if (change.entity === "contacts" || change.entity === "leads") {
          change.record.fullname =
            `${change.record.firstname} ${change.record.lastname}`.trim();
        }
        staged.set(`${change.entity}\0${change.id}`, change.record);
      }
    }
    const resolve = (entity, id) => {
      const record = staged.get(`${entity}\0${id}`) || this._lookup(entity, id);
      if (!record) throw new TypeError(`${entity} lookup ${id} does not resolve`);
      return record;
    };
    for (const change of changes) {
      const record = change.record;
      if (!record) continue;
      const definition = ENTITY_DEFINITIONS[change.entity];
      if (change.entity === "contacts" || change.entity === "leads") {
        record.fullname = `${record.firstname} ${record.lastname}`.trim();
      }
      for (const [field, fieldSchema] of Object.entries(definition.schema.fields)) {
        const lookup = fieldSchema.lookup;
        if (lookup) {
          const annotation = `${field}@OData.Community.Display.V1.FormattedValue`;
          if (record[field] === null || record[field] === undefined) {
            record[lookup.displayField] = null;
            delete record[annotation];
          } else {
            const target = lookup.discriminator
              ? record[lookup.discriminator]
              : lookup.targets[0];
            if (!lookup.targets.includes(target)) {
              throw new TypeError(`${change.entity}.${field} discriminator is invalid`);
            }
            const targetRecord = resolve(target, record[field]);
            const name = targetRecord[ENTITY_DEFINITIONS[target].primaryName];
            record[lookup.displayField] = name;
            record[annotation] = name;
          }
        }
        if (
          fieldSchema.options &&
          fieldSchema.formatted &&
          record[field] !== null &&
          record[field] !== undefined
        ) {
          const option = fieldSchema.options.find((item) => item.value === record[field]);
          if (!option) throw new TypeError(`${change.entity}.${field} option is invalid`);
          record[`${field}@OData.Community.Display.V1.FormattedValue`] = option.label;
        }
      }
      if (definition.schema.fields.exchangerate) {
        const currency = resolve(
          "transactioncurrencies",
          record.transactioncurrencyid,
        );
        if (decimalUnits(currency.exchangerate, 6) <= 0n) {
          throw new TypeError("transaction currency exchange rate must be positive");
        }
        record.exchangerate = currency.exchangerate;
      }
      if (change.entity === "emails") {
        record.fromname = record.senderidname;
        record.toname = record.recipientidname;
      }
      for (const [field, type] of Object.entries(definition.fields)) {
        if (record[field] === undefined) {
          if (!type.endsWith("?")) {
            throw new TypeError(`${change.entity}.${field} is required`);
          }
          record[field] = null;
        }
        validateFieldType(field, type, record[field], definition.schema.fields[field]);
        validateFieldConstraints(change.entity, field, record[field]);
      }
      validateRequiredFields(change.entity, record);
    }
  }

  _applyDocumentTotals(parent, lines) {
    let base = 0n;
    let discount = 0n;
    let tax = 0n;
    for (const line of lines) {
      base += decimalUnits(line.baseamount, 2);
      discount += decimalUnits(line.manualdiscountamount, 2);
      tax += decimalUnits(line.tax, 2);
    }
    const headerDiscount = parent.discountamount
      ? decimalUnits(parent.discountamount, 2)
      : 0n;
    const freight = parent.freightamount
      ? decimalUnits(parent.freightamount, 2)
      : 0n;
    parent.totallineitemamount = decimalText(base, 2);
    parent.totaldiscountamount = decimalText(discount + headerDiscount, 2);
    parent.totaltax = decimalText(tax, 2);
    const total = base - discount - headerDiscount + tax + freight;
    if (
      minBigInt(base, discount, headerDiscount, tax, freight, total) < 0n
    ) {
      throw new TypeError("document money and derived totals must be non-negative");
    }
    parent.totalamount = decimalText(total, 2);
  }

  _actionChangesResponse(action, changes, logicalId, extra = {}) {
    this._decorateStagedChanges(changes);
    const committed = this._commitBatch(changes, logicalId);
    this.creationCounter += changes.filter((change) => change.kind.startsWith("action-create")).length;
    return responseJson(
      {
        action,
        primary: committed[0]?.record ? clone(committed[0].record) : null,
        created: committed
          .filter((change) => change.kind.startsWith("action-create"))
          .map((change) => ({ entity: change.entity, id: change.id })),
        ...extra,
      },
      200,
    );
  }

  _actionUpdate(entity, current, values, kind = "action-update") {
    const record = { ...clone(current), ...values, modifiedon: this.clock.now() };
    return {
      entity,
      id: current[ENTITY_DEFINITIONS[entity].id],
      record,
      kind,
      before: current,
    };
  }

  _actionCreate(entity, record, kind = "action-create") {
    return {
      entity,
      id: record[ENTITY_DEFINITIONS[entity].id],
      record,
      kind,
      before: null,
    };
  }

  _copyLine(source, entity, logicalId, suffix, parentField, parentId) {
    const shared = {
      [parentField]: parentId,
      productid: source.productid,
      uomid: source.uomid,
      quantity: source.quantity,
      priceperunit: source.priceperunit,
      baseamount: source.baseamount,
      manualdiscountamount: source.manualdiscountamount,
      tax: source.tax,
      extendedamount: source.extendedamount,
      lineitemnumber: source.lineitemnumber,
      description: source.description,
      transactioncurrencyid: source.transactioncurrencyid,
    };
    if (entity === "quotedetails") {
      shared.ispriceoverridden = source.ispriceoverridden;
    }
    if (entity === "salesorderdetails") {
      shared.quotedetailid = source.quotedetailid || null;
      shared.quantityshipped = "0.00";
      shared.quantitycancelled = "0.00";
    }
    if (entity === "invoicedetails") {
      shared.salesorderdetailid = source.salesorderdetailid || null;
    }
    return this._newActionRecord(entity, logicalId, suffix, shared);
  }

  _bookingStatus(fieldServiceStatus) {
    const record = this._records("bookingstatuses").find(
      (candidate) => candidate.msdyn_fieldservicestatus === fieldServiceStatus,
    );
    if (!record) throw new TypeError(`booking status ${fieldServiceStatus} is unavailable`);
    return record;
  }

  _handleAction(route, init, headers, logicalId) {
    if ([...route.query.keys()].length) {
      return errorResponse(400, "0x80060888", "Actions do not accept query options.");
    }
    let payload;
    try {
      payload = validateActionPayload(route, parseBody(init.body));
      const now = this.clock.now();
      const action = route.action;

      if (action === "CloseIncident") {
        const target = this._actionCurrent(
          route,
          payload,
          "incidents",
          ["IncidentId", "incidentid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (target.record.statecode !== 0) throw new TypeError("only active cases can be resolved");
        const status = payload.Status ?? payload.status ?? 5;
        if (![5, 1000].includes(status)) throw new TypeError("CloseIncident status must resolve the case");
        const incident = this._actionUpdate("incidents", target.record, {
          statecode: 1,
          statuscode: status,
          resolvedon: now,
        });
        const resolution = this._newActionRecord(
          "incidentresolutions",
          logicalId,
          "resolution",
          {
            subject: payload.Subject || `Resolution for ${target.record.ticketnumber}`,
            incidentid: target.id,
            description: payload.Description ?? null,
            actualdurationminutes: payload.ActualDurationMinutes ?? 30,
            actualend: now,
            statecode: 1,
            statuscode: 2,
          },
        );
        return this._actionChangesResponse(
          action,
          [incident, this._actionCreate("incidentresolutions", resolution)],
          logicalId,
        );
      }

      if (action === "QualifyLead") {
        const target = this._actionCurrent(
          route,
          payload,
          "leads",
          ["LeadId", "leadid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        const lead = target.record;
        if (lead.statecode !== 0) throw new TypeError("only open leads can be qualified");
        const changes = [];
        let account = lead.parentaccountid
          ? this._lookup("accounts", lead.parentaccountid)
          : null;
        if (payload.CreateAccount === true) {
          account = this._newActionRecord("accounts", logicalId, "account", {
            name: payload.AccountName || lead.companyname,
            description: "Created atomically by QualifyLead simulator policy.",
          });
          changes.push(this._actionCreate("accounts", account));
        }
        let contact = lead.parentcontactid
          ? this._lookup("contacts", lead.parentcontactid)
          : null;
        if (payload.CreateContact === true) {
          if (!account) throw new TypeError("QualifyLead contact creation requires an account");
          contact = this._newActionRecord("contacts", logicalId, "contact", {
            firstname: lead.firstname,
            lastname: lead.lastname,
            emailaddress1: lead.emailaddress1,
            telephone1: lead.telephone1,
            parentcustomerid: account.accountid,
          });
          changes.push(this._actionCreate("contacts", contact));
        }
        let opportunity = null;
        if (payload.CreateOpportunity !== false) {
          if (!account && !contact) {
            throw new TypeError("QualifyLead opportunity creation requires a customer");
          }
          const priceList = payload.PriceLevelId
            ? this._lookup("pricelevels", normalizedRecordId(payload.PriceLevelId))
            : this._records("pricelevels").find(
                (candidate) => candidate.statecode === 0 && candidate.transactioncurrencyid === lead.transactioncurrencyid,
              );
          const currency = this._lookup(
            "transactioncurrencies",
            lead.transactioncurrencyid,
          );
          if (
            !priceList ||
            priceList.statecode !== 0 ||
            priceList.transactioncurrencyid !== lead.transactioncurrencyid ||
            !currency ||
            currency.statecode !== 0
          ) {
            throw new TypeError(
              "QualifyLead requires an active matching price list and currency",
            );
          }
          const customer = account || contact;
          const customerEntity = account ? "accounts" : "contacts";
          opportunity = this._newActionRecord("opportunities", logicalId, "opportunity", {
            name: payload.OpportunityName || lead.subject,
            description: lead.description,
            customerid: customer[ENTITY_DEFINITIONS[customerEntity].id],
            customeridtype: customerEntity,
            parentaccountid: account?.accountid ?? contact?.parentcustomerid ?? null,
            parentcontactid: contact?.contactid ?? null,
            originatingleadid: lead.leadid,
            pricelevelid: priceList.pricelevelid,
            transactioncurrencyid: lead.transactioncurrencyid,
            estimatedvalue: lead.estimatedamount || "0.00",
            actualvalue: null,
            estimatedclosedate:
              lead.estimatedclosedate || new Date(this.clock.valueOf() + 30 * 86400000).toISOString(),
            actualclosedate: null,
            closeprobability: 25,
            salesstagecode: 1,
            stepname: "Qualify",
            statecode: 0,
            statuscode: 1,
          });
          changes.push(this._actionCreate("opportunities", opportunity));
        }
        const leadChange = this._actionUpdate("leads", lead, {
          statecode: 1,
          statuscode: 3,
          parentaccountid: account?.accountid ?? lead.parentaccountid,
          parentcontactid: contact?.contactid ?? lead.parentcontactid,
          qualifyingopportunityid: opportunity?.opportunityid ?? null,
        });
        changes.unshift(leadChange);
        return this._actionChangesResponse(action, changes, logicalId);
      }

      if (["DisqualifyLead", "ReopenLead"].includes(action)) {
        const target = this._actionCurrent(
          route,
          payload,
          "leads",
          ["LeadId", "leadid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (action === "DisqualifyLead") {
          if (target.record.statecode !== 0) throw new TypeError("only open leads can be disqualified");
          const status = payload.Status ?? 4;
          if (![4, 5, 6, 7].includes(status)) throw new TypeError("invalid disqualification status");
          return this._actionChangesResponse(
            action,
            [this._actionUpdate("leads", target.record, { statecode: 2, statuscode: status })],
            logicalId,
          );
        }
        if (target.record.statecode === 0) throw new TypeError("lead is already open");
        return this._actionChangesResponse(
          action,
          [this._actionUpdate("leads", target.record, { statecode: 0, statuscode: 1 })],
          logicalId,
        );
      }

      if (["WinOpportunity", "LoseOpportunity"].includes(action)) {
        const target = this._actionCurrent(
          route,
          payload,
          "opportunities",
          ["OpportunityId", "opportunityid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (target.record.statecode !== 0) throw new TypeError("only open opportunities can be closed");
        const won = action === "WinOpportunity";
        const status = won ? 3 : payload.Status ?? 4;
        if (!won && ![4, 5].includes(status)) throw new TypeError("invalid lost opportunity status");
        const revenue = won
          ? payload.ActualRevenue ?? target.record.totalamount ?? target.record.estimatedvalue
          : "0.00";
        validateFieldType("ActualRevenue", "decimal", revenue, { scale: 2 });
        const opportunity = this._actionUpdate("opportunities", target.record, {
          statecode: won ? 1 : 2,
          statuscode: status,
          actualvalue: revenue,
          actualclosedate: now,
          closeprobability: won ? 100 : 0,
          salesstagecode: 4,
          stepname: "Close",
        });
        const close = this._newActionRecord("opportunitycloses", logicalId, "close", {
          subject: `${won ? "Won" : "Lost"}: ${target.record.name}`,
          opportunityid: target.id,
          actualrevenue: revenue,
          competitoridname: payload.CompetitorName ?? null,
          description: payload.Description ?? null,
          actualend: now,
          statecode: 1,
          statuscode: 2,
        });
        return this._actionChangesResponse(
          action,
          [opportunity, this._actionCreate("opportunitycloses", close)],
          logicalId,
        );
      }

      if (action === "ReopenOpportunity") {
        const target = this._actionCurrent(
          route,
          payload,
          "opportunities",
          ["OpportunityId", "opportunityid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (target.record.statecode === 0) throw new TypeError("opportunity is already open");
        return this._actionChangesResponse(
          action,
          [
            this._actionUpdate("opportunities", target.record, {
              statecode: 0,
              statuscode: 1,
              actualvalue: null,
              actualclosedate: null,
              closeprobability: 50,
              salesstagecode: 3,
              stepname: "Propose",
            }),
          ],
          logicalId,
        );
      }

      if (action === "GenerateQuote") {
        const target = this._actionCurrent(
          route,
          payload,
          "opportunities",
          ["OpportunityId", "opportunityid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (target.record.statecode !== 0) throw new TypeError("quotes require an open opportunity");
        const opportunity = target.record;
        const quote = this._newActionRecord("quotes", logicalId, "quote", {
          name: payload.Name || `Proposal for ${opportunity.customeridname}`,
          customerid: opportunity.customerid,
          customeridtype: opportunity.customeridtype,
          pricelevelid: opportunity.pricelevelid,
          transactioncurrencyid: opportunity.transactioncurrencyid,
          description: payload.Description ?? opportunity.description,
          freightamount: payload.FreightAmount ?? "0.00",
          discountamount: payload.DiscountAmount ?? "0.00",
          opportunityid: opportunity.opportunityid,
          revisionnumber: 1,
          effectivefrom: now,
          effectiveto: new Date(this.clock.valueOf() + 30 * 86400000).toISOString(),
          statecode: 0,
          statuscode: 1,
        });
        const sourceLines = this._records("opportunityproducts").filter(
          (line) => line.opportunityid === opportunity.opportunityid,
        );
        const lines = sourceLines.map((line, index) =>
          this._copyLine(
            line,
            "quotedetails",
            logicalId,
            `quote-line-${index}`,
            "quoteid",
            quote.quoteid,
          ),
        );
        this._applyDocumentTotals(quote, lines);
        const changes = [
          this._actionCreate("quotes", quote),
          ...lines.map((line) => this._actionCreate("quotedetails", line)),
        ];
        return this._actionChangesResponse(action, changes, logicalId);
      }

      if (["ActivateQuote", "WinQuote", "CloseQuote"].includes(action)) {
        const target = this._actionCurrent(
          route,
          payload,
          "quotes",
          ["QuoteId", "quoteid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        let values;
        if (action === "ActivateQuote") {
          if (target.record.statecode !== 0) throw new TypeError("only draft quotes can be activated");
          if (!this._records("quotedetails").some((line) => line.quoteid === target.id)) {
            throw new TypeError("quote activation requires at least one line");
          }
          values = { statecode: 1, statuscode: 2 };
        } else if (action === "WinQuote") {
          if (target.record.statecode !== 1) throw new TypeError("only active quotes can be won");
          values = { statecode: 2, statuscode: 3 };
        } else {
          if (![0, 1].includes(target.record.statecode)) throw new TypeError("quote is already closed");
          const status = payload.Status ?? 5;
          if (![4, 5].includes(status)) throw new TypeError("invalid quote close status");
          values = { statecode: 3, statuscode: status };
        }
        return this._actionChangesResponse(
          action,
          [this._actionUpdate("quotes", target.record, values)],
          logicalId,
        );
      }

      if (action === "ReviseQuote") {
        const target = this._actionCurrent(
          route,
          payload,
          "quotes",
          ["QuoteId", "quoteid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (target.record.statecode !== 1) throw new TypeError("only active quotes can be revised");
        const original = this._actionUpdate("quotes", target.record, {
          statecode: 3,
          statuscode: 6,
        });
        const revised = this._newActionRecord("quotes", logicalId, "revision", {
          ...Object.fromEntries(
            [
              "name", "customerid", "customeridtype", "pricelevelid",
              "transactioncurrencyid", "description", "freightamount",
              "discountamount", "opportunityid", "effectivefrom", "effectiveto",
            ].map((field) => [field, target.record[field]]),
          ),
          revisionnumber: target.record.revisionnumber + 1,
          statecode: 0,
          statuscode: 1,
        });
        const sourceLines = this._records("quotedetails").filter(
          (line) => line.quoteid === target.id,
        );
        const lines = sourceLines.map((line, index) =>
          this._copyLine(
            line,
            "quotedetails",
            logicalId,
            `revision-line-${index}`,
            "quoteid",
            revised.quoteid,
          ),
        );
        this._applyDocumentTotals(revised, lines);
        return this._actionChangesResponse(
          action,
          [
            original,
            this._actionCreate("quotes", revised),
            ...lines.map((line) => this._actionCreate("quotedetails", line)),
          ],
          logicalId,
        );
      }

      if (action === "ConvertQuoteToSalesOrder") {
        const target = this._actionCurrent(
          route,
          payload,
          "quotes",
          ["QuoteId", "quoteid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (![1, 2].includes(target.record.statecode)) {
          throw new TypeError("only active or won quotes can become orders");
        }
        if (this._records("salesorders").some((order) => order.quoteid === target.id)) {
          throw new TypeError("quote already has an order");
        }
        const quote = target.record;
        const order = this._newActionRecord("salesorders", logicalId, "order", {
          name: payload.Name || `Order for ${quote.customeridname}`,
          customerid: quote.customerid,
          customeridtype: quote.customeridtype,
          pricelevelid: quote.pricelevelid,
          transactioncurrencyid: quote.transactioncurrencyid,
          description: quote.description,
          freightamount: quote.freightamount,
          discountamount: quote.discountamount,
          quoteid: quote.quoteid,
          opportunityid: quote.opportunityid,
          datefulfilled: null,
          requestdeliveryby: payload.RequestDeliveryBy
            ? normalizeUtc(payload.RequestDeliveryBy, "RequestDeliveryBy")
            : new Date(this.clock.valueOf() + 14 * 86400000).toISOString(),
          statecode: 0,
          statuscode: 1,
        });
        const sourceLines = this._records("quotedetails").filter(
          (line) => line.quoteid === quote.quoteid,
        );
        if (!sourceLines.length) throw new TypeError("quote conversion requires lines");
        const lines = sourceLines.map((line, index) => {
          const copied = this._copyLine(
            line,
            "salesorderdetails",
            logicalId,
            `order-line-${index}`,
            "salesorderid",
            order.salesorderid,
          );
          copied.quotedetailid = line.quotedetailid;
          return copied;
        });
        this._applyDocumentTotals(order, lines);
        return this._actionChangesResponse(
          action,
          [
            this._actionCreate("salesorders", order),
            ...lines.map((line) => this._actionCreate("salesorderdetails", line)),
            this._actionUpdate("quotes", quote, { statecode: 2, statuscode: 3 }),
          ],
          logicalId,
        );
      }

      if (["CancelSalesOrder", "FulfillSalesOrder"].includes(action)) {
        const target = this._actionCurrent(
          route,
          payload,
          "salesorders",
          ["SalesOrderId", "salesorderid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (![0, 1].includes(target.record.statecode)) throw new TypeError("order is terminal");
        const fulfill = action === "FulfillSalesOrder";
        const changes = [
          this._actionUpdate("salesorders", target.record, {
            statecode: fulfill ? 3 : 2,
            statuscode: fulfill ? 6 : 5,
            datefulfilled: fulfill ? now : null,
          }),
        ];
        for (const line of this._records("salesorderdetails").filter(
          (item) => item.salesorderid === target.id,
        )) {
          changes.push(
            this._actionUpdate("salesorderdetails", line, {
              quantityshipped: fulfill ? line.quantity : "0.00",
              quantitycancelled: fulfill ? "0.00" : line.quantity,
            }),
          );
        }
        return this._actionChangesResponse(action, changes, logicalId);
      }

      if (action === "ConvertSalesOrderToInvoice") {
        const target = this._actionCurrent(
          route,
          payload,
          "salesorders",
          ["SalesOrderId", "salesorderid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (target.record.statecode !== 3) throw new TypeError("only fulfilled orders can be invoiced");
        if (this._records("invoices").some((invoice) => invoice.salesorderid === target.id)) {
          throw new TypeError("order already has an invoice");
        }
        const order = target.record;
        const invoice = this._newActionRecord("invoices", logicalId, "invoice", {
          name: payload.Name || `Invoice for ${order.customeridname}`,
          customerid: order.customerid,
          customeridtype: order.customeridtype,
          pricelevelid: order.pricelevelid,
          transactioncurrencyid: order.transactioncurrencyid,
          description: order.description,
          freightamount: order.freightamount,
          discountamount: order.discountamount,
          salesorderid: order.salesorderid,
          opportunityid: order.opportunityid,
          datedelivered: order.datefulfilled,
          duedate: payload.DueDate
            ? normalizeUtc(payload.DueDate, "DueDate")
            : new Date(this.clock.valueOf() + 30 * 86400000).toISOString(),
          statecode: 0,
          statuscode: 1,
        });
        const sourceLines = this._records("salesorderdetails").filter(
          (line) => line.salesorderid === order.salesorderid,
        );
        const lines = sourceLines.map((line, index) => {
          const copied = this._copyLine(
            line,
            "invoicedetails",
            logicalId,
            `invoice-line-${index}`,
            "invoiceid",
            invoice.invoiceid,
          );
          copied.salesorderdetailid = line.salesorderdetailid;
          return copied;
        });
        this._applyDocumentTotals(invoice, lines);
        return this._actionChangesResponse(
          action,
          [
            this._actionCreate("invoices", invoice),
            ...lines.map((line) => this._actionCreate("invoicedetails", line)),
          ],
          logicalId,
        );
      }

      if (["MarkInvoicePaid", "CancelInvoice"].includes(action)) {
        const target = this._actionCurrent(
          route,
          payload,
          "invoices",
          ["InvoiceId", "invoiceid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (target.record.statecode !== 0) throw new TypeError("invoice is terminal");
        const paid = action === "MarkInvoicePaid";
        return this._actionChangesResponse(
          action,
          [
            this._actionUpdate("invoices", target.record, {
              statecode: paid ? 1 : 2,
              statuscode: paid ? 5 : 4,
            }),
          ],
          logicalId,
        );
      }

      if (action === "CreateWorkOrder") {
        const incidentId = this._actionTargetId(
          route,
          payload,
          ["CaseId", "incidentid"],
        );
        const incident = this._lookup("incidents", incidentId);
        if (!incident) throw new TypeError("CreateWorkOrder case was not found");
        const accountId = payload.AccountId
          ? normalizedRecordId(payload.AccountId)
          : incident.customeridtype === "accounts"
            ? incident.customerid
            : this._lookup("contacts", incident.customerid)?.parentcustomerid;
        const assetId = payload.CustomerAssetId
          ? normalizedRecordId(payload.CustomerAssetId)
          : this._records("msdyn_customerassets").find(
              (candidate) => candidate.msdyn_account === accountId,
            )?.msdyn_customerassetid;
        const asset = this._lookup("msdyn_customerassets", assetId);
        if (!asset || asset.msdyn_account !== accountId) {
          throw new TypeError("CreateWorkOrder asset and account must match the case");
        }
        const account = this._lookup("accounts", accountId);
        const workOrderType = payload.WorkOrderTypeId
          ? this._lookup("msdyn_workordertypes", normalizedRecordId(payload.WorkOrderTypeId))
          : this._records("msdyn_workordertypes")[0];
        const incidentType = payload.IncidentTypeId
          ? this._lookup("msdyn_incidenttypes", normalizedRecordId(payload.IncidentTypeId))
          : this._records("msdyn_incidenttypes")[0];
        const priority = payload.PriorityId
          ? this._lookup("msdyn_priorities", normalizedRecordId(payload.PriorityId))
          : this._records("msdyn_priorities")[1];
        if (!account || !workOrderType || !incidentType || !priority) {
          throw new TypeError("CreateWorkOrder reference data is incomplete");
        }
        const windowStart = payload.WindowStart
          ? normalizeUtc(payload.WindowStart, "WindowStart")
          : now;
        const windowStartMilliseconds = new Date(windowStart).valueOf();
        const windowEnd = payload.WindowEnd
          ? normalizeUtc(payload.WindowEnd, "WindowEnd")
          : new Date(windowStartMilliseconds + 4 * 3600000).toISOString();
        if (new Date(windowEnd).valueOf() <= windowStartMilliseconds) {
          throw new TypeError("CreateWorkOrder window end must be after its start");
        }
        const workorder = this._newActionRecord("msdyn_workorders", logicalId, "workorder", {
          msdyn_serviceaccount: accountId,
          msdyn_billingaccount: accountId,
          msdyn_reportedbycontact: incident.primarycontactid,
          msdyn_servicerequest: incidentId,
          msdyn_customerasset: assetId,
          msdyn_workordertype: workOrderType.msdyn_workordertypeid,
          msdyn_primaryincidenttype: incidentType.msdyn_incidenttypeid,
          msdyn_priority: priority.msdyn_priorityid,
          msdyn_systemstatus: 690970000,
          msdyn_address1: account.address1_line1,
          msdyn_city: account.address1_city,
          msdyn_stateorprovince: account.address1_stateorprovince,
          msdyn_postalcode: account.address1_postalcode,
          msdyn_country: account.address1_country,
          msdyn_instructions: payload.Instructions ?? null,
          msdyn_datewindowstart: windowStart,
          msdyn_datewindowend: windowEnd,
          msdyn_timefrompromised: windowStart,
          msdyn_timetopromised: windowEnd,
          msdyn_firstarrivedon: null,
          msdyn_completedon: null,
          statecode: 0,
          statuscode: 1,
        });
        this._prepareDerived("msdyn_workorders", workorder, payload, null);
        const requirement = this._newActionRecord(
          "msdyn_resourcerequirements",
          logicalId,
          "requirement",
          {
            msdyn_name: `Primary requirement for ${workorder.msdyn_name}`,
            msdyn_workorder: workorder.msdyn_workorderid,
            msdyn_fromdate: windowStart,
            msdyn_todate: windowEnd,
            msdyn_duration: incidentType.msdyn_estimatedduration,
            msdyn_isprimary: true,
            statecode: 0,
            statuscode: 1,
          },
        );
        const workorderIncident = this._newActionRecord(
          "msdyn_workorderincidents",
          logicalId,
          "workorder-incident",
          {
            msdyn_name: `${workorder.msdyn_name} incident`,
            msdyn_workorder: workorder.msdyn_workorderid,
            msdyn_incidenttype: incidentType.msdyn_incidenttypeid,
            msdyn_customerasset: assetId,
            msdyn_estimatedduration: incidentType.msdyn_estimatedduration,
          },
        );
        const taskTypes = this._records("msdyn_servicetasktypes").slice(0, 3);
        const tasks = taskTypes.map((taskType, index) =>
          this._newActionRecord(
            "msdyn_workorderservicetasks",
            logicalId,
            `service-task-${index}`,
            {
              msdyn_name: `${taskType.msdyn_name} — ${workorder.msdyn_name}`,
              msdyn_workorder: workorder.msdyn_workorderid,
              msdyn_tasktype: taskType.msdyn_servicetasktypeid,
              msdyn_description: taskType.msdyn_description,
              msdyn_percentcomplete: 0,
              msdyn_inspectiontaskresult: null,
            },
          ),
        );
        return this._actionChangesResponse(
          action,
          [
            this._actionCreate("msdyn_workorders", workorder),
            this._actionCreate("msdyn_resourcerequirements", requirement),
            this._actionCreate("msdyn_workorderincidents", workorderIncident),
            ...tasks.map((task) => this._actionCreate("msdyn_workorderservicetasks", task)),
          ],
          logicalId,
        );
      }

      if (action === "ScheduleWorkOrder") {
        const target = this._actionCurrent(
          route,
          payload,
          "msdyn_workorders",
          ["WorkOrderId", "msdyn_workorderid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (
          target.record.statecode !== 0 ||
          target.record.msdyn_systemstatus !== 690970000
        ) {
          throw new TypeError(
            "only active unscheduled work orders can be scheduled",
          );
        }
        const resourceId = normalizedRecordId(payload.ResourceId);
        const resource = this._lookup("bookableresources", resourceId);
        if (!resource || resource.statecode !== 0) {
          throw new TypeError("ScheduleWorkOrder requires an active resource");
        }
        const requirement = this._records("msdyn_resourcerequirements").find(
          (item) => item.msdyn_workorder === target.id && item.msdyn_isprimary,
        );
        if (
          !requirement ||
          requirement.statecode !== 0 ||
          requirement.statuscode !== 1
        ) {
          throw new TypeError(
            "work order requires an active primary requirement",
          );
        }
        const status = this._bookingStatus(690970000);
        const booking = this._newActionRecord(
          "bookableresourcebookings",
          logicalId,
          "booking",
          {
            name: `${target.record.msdyn_name} booking`,
            resource: resourceId,
            bookingstatus: status.bookingstatusid,
            starttime: normalizeUtc(payload.StartTime, "StartTime"),
            endtime: normalizeUtc(payload.EndTime, "EndTime"),
            msdyn_workorder: target.id,
            msdyn_resourcerequirement: requirement.msdyn_resourcerequirementid,
            statecode: 0,
            statuscode: 1,
          },
        );
        this._prepareDerived("bookableresourcebookings", booking, payload, null);
        return this._actionChangesResponse(
          action,
          [
            this._actionUpdate("msdyn_workorders", target.record, {
              msdyn_systemstatus: 690970001,
              msdyn_timefrompromised: booking.starttime,
              msdyn_timetopromised: booking.endtime,
            }),
            this._actionCreate("bookableresourcebookings", booking),
          ],
          logicalId,
        );
      }

      if (["DispatchWorkOrder", "StartWorkOrder"].includes(action)) {
        const target = this._actionCurrent(
          route,
          payload,
          "msdyn_workorders",
          ["WorkOrderId", "msdyn_workorderid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (target.record.statecode !== 0) throw new TypeError("work order is terminal");
        const starting = action === "StartWorkOrder";
        if (
          (!starting && target.record.msdyn_systemstatus !== 690970001) ||
          (starting && ![690970001, 690970002].includes(target.record.msdyn_systemstatus))
        ) {
          throw new TypeError(`work order cannot ${starting ? "start service" : "dispatch"} from its current phase`);
        }
        const nextStatus = this._bookingStatus(starting ? 690970002 : 690970001);
        const bookings = this._records("bookableresourcebookings").filter(
          (booking) => booking.msdyn_workorder === target.id && booking.statecode === 0,
        );
        if (!bookings.length) throw new TypeError("work order has no active booking");
        const changes = [
          this._actionUpdate("msdyn_workorders", target.record, {
            msdyn_systemstatus: starting ? 690970002 : 690970001,
            msdyn_firstarrivedon: starting
              ? now
              : target.record.msdyn_firstarrivedon,
          }),
          ...bookings.map((booking) =>
            this._actionUpdate("bookableresourcebookings", booking, {
              bookingstatus: nextStatus.bookingstatusid,
            }),
          ),
        ];
        return this._actionChangesResponse(action, changes, logicalId);
      }

      if (["CompleteBooking", "CancelBooking"].includes(action)) {
        const target = this._actionCurrent(
          route,
          payload,
          "bookableresourcebookings",
          ["BookingId", "bookableresourcebookingid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        if (target.record.statecode !== 0) throw new TypeError("booking is already terminal");
        const completed = action === "CompleteBooking";
        const status = this._bookingStatus(completed ? 690970003 : 690970004);
        const workorder = this._lookup("msdyn_workorders", target.record.msdyn_workorder);
        const booking = this._actionUpdate("bookableresourcebookings", target.record, {
          bookingstatus: status.bookingstatusid,
          statecode: 1,
          statuscode: 2,
        });
        const workorderChange = this._actionUpdate("msdyn_workorders", workorder, {
          msdyn_systemstatus: completed
            ? 690970002
            : workorder.msdyn_systemstatus,
        });
        return this._actionChangesResponse(
          action,
          [booking, workorderChange],
          logicalId,
        );
      }

      if (["CompleteWorkOrder", "CancelWorkOrder", "ReopenWorkOrder"].includes(action)) {
        const target = this._actionCurrent(
          route,
          payload,
          "msdyn_workorders",
          ["WorkOrderId", "msdyn_workorderid"],
          headers,
        );
        if (target.precondition) return target.precondition;
        const bookings = this._records("bookableresourcebookings").filter(
          (booking) => booking.msdyn_workorder === target.id,
        );
        const tasks = this._records("msdyn_workorderservicetasks").filter(
          (task) => task.msdyn_workorder === target.id,
        );
        if (action === "CompleteWorkOrder") {
          if (target.record.statecode !== 0) throw new TypeError("work order is terminal");
          if (bookings.some((booking) => booking.statecode === 0)) {
            throw new TypeError("all bookings must be completed or canceled");
          }
          if (!tasks.length || tasks.some((task) => task.msdyn_percentcomplete !== 100)) {
            throw new TypeError("all service tasks must be complete");
          }
          const childChanges = [];
          for (const entity of [
            "msdyn_resourcerequirements",
            "msdyn_workorderservicetasks",
            "msdyn_workorderproducts",
            "msdyn_workorderservices",
            "msdyn_workorderincidents",
          ]) {
            for (const child of this._records(entity).filter(
              (record) => record.msdyn_workorder === target.id,
            )) {
              childChanges.push(
                this._actionUpdate(entity, child, {
                  statecode: 1,
                  statuscode: 2,
                }),
              );
            }
          }
          return this._actionChangesResponse(
            action,
            [
              this._actionUpdate("msdyn_workorders", target.record, {
                msdyn_systemstatus: 690970003,
                msdyn_completedon: now,
                statecode: 1,
                statuscode: 2,
              }),
              ...childChanges,
            ],
            logicalId,
          );
        }
        if (action === "CancelWorkOrder") {
          if (target.record.statecode !== 0) throw new TypeError("work order is terminal");
          const canceledStatus = this._bookingStatus(690970004);
          const changes = [
            this._actionUpdate("msdyn_workorders", target.record, {
              msdyn_systemstatus: 690970005,
              msdyn_completedon: now,
              statecode: 1,
              statuscode: 2,
            }),
          ];
          for (const booking of bookings.filter((item) => item.statecode === 0)) {
            changes.push(
              this._actionUpdate("bookableresourcebookings", booking, {
                bookingstatus: canceledStatus.bookingstatusid,
                statecode: 1,
                statuscode: 2,
              }),
            );
          }
          for (const task of tasks) {
            changes.push(
              this._actionUpdate("msdyn_workorderservicetasks", task, {
                msdyn_percentcomplete: 100,
                statecode: 1,
                statuscode: 2,
              }),
            );
          }
          for (const entity of [
            "msdyn_resourcerequirements",
            "msdyn_workorderproducts",
            "msdyn_workorderservices",
            "msdyn_workorderincidents",
          ]) {
            for (const child of this._records(entity).filter(
              (record) => record.msdyn_workorder === target.id,
            )) {
              changes.push(
                this._actionUpdate(entity, child, {
                  statecode: 1,
                  statuscode: 2,
                }),
              );
            }
          }
          return this._actionChangesResponse(action, changes, logicalId);
        }
        if (target.record.statecode !== 1) throw new TypeError("only terminal work orders can reopen");
        const requirement = this._records("msdyn_resourcerequirements").find(
          (item) => item.msdyn_workorder === target.id && item.msdyn_isprimary,
        );
        const changes = [
          this._actionUpdate("msdyn_workorders", target.record, {
            msdyn_systemstatus: 690970000,
            msdyn_firstarrivedon: null,
            msdyn_completedon: null,
            statecode: 0,
            statuscode: 1,
          }),
          ...tasks.map((task) =>
            this._actionUpdate("msdyn_workorderservicetasks", task, {
              msdyn_percentcomplete: 0,
              msdyn_inspectiontaskresult: null,
              statecode: 0,
              statuscode: 1,
            }),
          ),
        ];
        for (const entity of [
          "msdyn_resourcerequirements",
          "msdyn_workorderproducts",
          "msdyn_workorderservices",
          "msdyn_workorderincidents",
        ]) {
          for (const child of this._records(entity).filter(
            (record) => record.msdyn_workorder === target.id,
          )) {
            changes.push(
              this._actionUpdate(entity, child, {
                statecode: 0,
                statuscode: 1,
              }),
            );
          }
        }
        return this._actionChangesResponse(action, changes, logicalId);
      }

      throw new TypeError(`action ${action} is not registered`);
    } catch (error) {
      return errorResponse(400, "0x80060888", error.message);
    }
  }


  _handleMutation(method, route, init, headers, logicalId) {
    const definition = ENTITY_DEFINITIONS[route.entity];
    if (!definition) return errorResponse(404, "0x80060888", "Resource not found.");
    const preferRepresentation = (headers.get("prefer") || "")
      .split(",")
      .map((value) => value.trim())
      .includes("return=representation");
    if (method === "POST") {
      if (route.kind !== "collection") {
        return errorResponse(405, "0x80060888", "POST requires an entity collection.");
      }
      let payload;
      try {
        payload = validatePayload(route.entity, parseBody(init.body), "POST");
      } catch (error) {
        return errorResponse(400, "0x80060888", error.message);
      }
      const creationOrdinal = this.creationCounter + 1;
      const creationToken = `create-${String(creationOrdinal).padStart(8, "0")}`;
      const id = deterministicGuid(`${this.seedDigest}/${route.entity}/${creationToken}/primary`);
      if (this._lookup(route.entity, id)) {
        return errorResponse(409, "0x80040237", "A record with the generated id already exists.");
      }
      try {
        this._assertRecordWritable(route.entity, null, payload, "create");
        const record = { ...this._defaults(route.entity, creationToken, payload), ...payload };
        record[definition.id] = id;
        this._prepareDerived(route.entity, record, payload, null);
        if (route.entity === "emails") this._ensureEmailParties(record, true);
        this._validateLookups(route.entity, record);
        validateRequiredFields(route.entity, record);
        const changes = [
          {
            entity: route.entity,
            id,
            record,
            kind: "create",
            before: null,
          },
        ];
        if (route.entity === "connections") {
          const reciprocalId = deterministicGuid(
            `${this.seedDigest}/${route.entity}/${creationToken}/reciprocal`,
          );
          if (this._lookup(route.entity, reciprocalId)) {
            throw new TypeError("the generated reciprocal connection id already exists");
          }
          const reciprocal = {
            ...clone(record),
            connectionid: reciprocalId,
            record1id: record.record2id,
            record1idname: record.record2idname,
            record1type: record.record2type,
            record2id: record.record1id,
            record2idname: record.record1idname,
            record2type: record.record1type,
            record1roleidname: record.record2roleidname ?? null,
            record2roleidname: record.record1roleidname ?? null,
          };
          this._validateLookups("connections", reciprocal);
          validateRequiredFields("connections", reciprocal);
          changes.push({
            entity: "connections",
            id: reciprocalId,
            record: reciprocal,
            kind: "create-reciprocal",
            before: null,
          });
        }
        const rollup = this._lineRollupChange(route.entity, record);
        if (rollup) changes.push(rollup);
        const committed = this._commitBatch(changes, logicalId)[0].record;
        this.creationCounter = creationOrdinal;
        const headersOut = {
          etag: committed["@odata.etag"],
          "odata-entityid": `${route.entity}(${id})`,
        };
        return preferRepresentation
          ? responseJson(clone(committed), 201, headersOut)
          : emptyResponse(204, headersOut);
      } catch (error) {
        return errorResponse(400, "0x80060888", error.message);
      }
    }
    if (method === "DELETE" && route.kind === "collection") {
      return this._handleDeleteMany(route, init, logicalId);
    }
    if (route.kind !== "record") {
      return errorResponse(405, "0x80060888", `${method} requires a record URL.`);
    }
    const current = this._lookup(route.entity, route.id);
    if (!current) return errorResponse(404, "0x80040217", "The requested record was not found.");
    const precondition = this._ifMatch(current, headers);
    if (precondition) return precondition;
    if (method === "DELETE") {
      try {
        this._assertRecordWritable(route.entity, current, {}, "delete");
      } catch (error) {
        return errorResponse(400, "0x80060888", error.message);
      }
      if (route.entity === "connections") {
        const reciprocal = this._records("connections").find(
          (record) =>
            record.connectionpairid === current.connectionpairid &&
            record.connectionid !== current.connectionid,
        );
        if (!reciprocal) {
          return errorResponse(409, "0x80040265", "The reciprocal connection is missing.");
        }
        try {
          this._commitBatch(
            [
              {
                entity: "connections",
                id: current.connectionid,
                record: null,
                kind: "delete",
                before: current,
              },
              {
                entity: "connections",
                id: reciprocal.connectionid,
                record: null,
                kind: "delete-reciprocal",
                before: reciprocal,
              },
            ],
            logicalId,
          );
        } catch (error) {
          return errorResponse(400, "0x80060888", error.message);
        }
      } else {
        const references = this._deleteGuard(route.entity, route.id);
        if (references.length) {
          return errorResponse(
            409,
            "0x80040265",
            `The record is referenced by ${references.length} related record(s).`,
          );
        }
        const changes = [{
            entity: route.entity,
            id: route.id,
            record: null,
            kind: "delete",
            before: current,
          }];
        const rollup = this._lineRollupChange(
          route.entity,
          null,
          current,
          true,
        );
        if (rollup) changes.push(rollup);
        try {
          this._commitBatch(changes, logicalId);
        } catch (error) {
          return errorResponse(400, "0x80060888", error.message);
        }
      }
      return emptyResponse(204);
    }
    let payload;
    try {
      payload = validatePayload(route.entity, parseBody(init.body), "PATCH");
      this._assertRecordWritable(route.entity, current, payload, "update");
      const merged = { ...clone(current), ...payload, modifiedon: this.clock.now() };
      if (route.entity === "incidents" && payload.statecode !== undefined) {
        merged.resolvedon =
          merged.statecode === 0
            ? null
            : current.statecode === 0
              ? this.clock.now()
              : current.resolvedon;
      }
      if (
        route.entity === "tasks" &&
        payload.statecode !== undefined &&
        merged.statecode !== 0 &&
        !merged.actualend
      ) {
        merged.actualend = this.clock.now();
      }
      this._prepareDerived(route.entity, merged, payload, current);
      if (route.entity === "emails") this._ensureEmailParties(merged);
      this._validateLookups(route.entity, merged);
      validateRequiredFields(route.entity, merged);
      const changes = [
        {
          entity: route.entity,
          id: route.id,
          record: merged,
          kind: "update",
          before: current,
        },
      ];
      if (
        merged[definition.primaryName] !== current[definition.primaryName]
      ) {
        changes.push(...this._namePropagationChanges(route.entity, route.id, merged));
      }
      if (route.entity === "connections") {
        const reciprocalCurrent = this._records("connections").find(
          (record) =>
            record.connectionpairid === current.connectionpairid &&
            record.connectionid !== current.connectionid,
        );
        if (!reciprocalCurrent) throw new TypeError("the reciprocal connection is missing");
        const reciprocal = {
          ...clone(reciprocalCurrent),
          record1id: merged.record2id,
          record1type: merged.record2type,
          record2id: merged.record1id,
          record2type: merged.record1type,
          record1roleidname: merged.record2roleidname,
          record2roleidname: merged.record1roleidname,
          description: merged.description,
          effectivestart: merged.effectivestart,
          effectiveend: merged.effectiveend,
          statecode: merged.statecode,
          statuscode: merged.statuscode,
          ownerid: merged.ownerid,
        };
        this._validateLookups("connections", reciprocal);
        validateRequiredFields("connections", reciprocal);
        changes.push({
          entity: "connections",
          id: reciprocal.connectionid,
          record: reciprocal,
          kind: "update-reciprocal",
          before: reciprocalCurrent,
        });
      }
      const rollup = this._lineRollupChange(route.entity, merged, current);
      if (rollup) changes.push(rollup);
      const committed = this._commitBatch(changes, logicalId)[0].record;
      return preferRepresentation
        ? responseJson(clone(committed), 200, { etag: committed["@odata.etag"] })
        : emptyResponse(204, { etag: committed["@odata.etag"] });
    } catch (error) {
      return errorResponse(400, "0x80060888", error.message);
    }
  }

  async _attempt(input, init, logicalId, attempt) {
    const method = String(init.method || "GET").toUpperCase();
    const headers = new TwinHeaders(init.headers);
    let route;
    try {
      route = parsePath(input);
    } catch (error) {
      return errorResponse(400, "0x80060888", error.message);
    }
    const context = { method, route, logicalId, attempt };
    this._event("request", {
      method,
      path: route.pathname,
      logicalRequestId: logicalId,
      attempt,
    });
    const preFault = this._takeFault(context, "pre");
    const faultResponse = this._applyPreFault(preFault, context);
    if (faultResponse) return faultResponse;

    let fingerprint;
    try {
      fingerprint = sha256(
        canonicalStringify({
          method,
          path: route.pathname,
          query: [...route.query.entries()],
          headers: headers.toObject(),
          body:
            init.body === undefined
              ? null
              : typeof init.body === "string"
                ? init.body
                : init.body,
        }),
      );
    } catch (error) {
      return errorResponse(400, "0x80060888", error.message);
    }
    if (MUTATION_METHODS.has(method) && this.idempotency.has(logicalId)) {
      const cached = this.idempotency.get(logicalId);
      if (cached.fingerprint !== fingerprint) {
        return errorResponse(
          409,
          "0x8004D101",
          "The logical request id was already used for a different mutation.",
        );
      }
      this._event("idempotent-replay", { logicalRequestId: logicalId, attempt });
      return restoreResponse(cached.response);
    }

    let response;
    if (route.kind === "action") {
      response =
        method === "POST"
          ? this._handleAction(route, init, headers, logicalId)
          : errorResponse(405, "0x80060888", "Actions require POST.");
    } else if (method === "GET") response = this._handleGet(route);
    else if (MUTATION_METHODS.has(method)) {
      response = this._handleMutation(method, route, init, headers, logicalId);
    } else {
      response = errorResponse(405, "0x80060888", `Method ${method} is not supported.`);
    }
    if (MUTATION_METHODS.has(method) && response.ok) {
      this.idempotency.set(logicalId, {
        fingerprint,
        response: responseSnapshot(response),
      });
      const postFault = this._takeFault(context, "post");
      if (postFault) {
        throw new TwinTransportError("response lost after committed mutation", "EPOSTCOMMIT");
      }
    }
    this._event("response", {
      logicalRequestId: logicalId,
      attempt,
      status: response.status,
    });
    return response;
  }

  _retryConfig(init) {
    const supplied = init.retry || {};
    const config = {
      maxAttempts: supplied.maxAttempts ?? this.retryDefaults.maxAttempts,
      baseDelayMs: supplied.baseDelayMs ?? this.retryDefaults.baseDelayMs,
      maxDelayMs: supplied.maxDelayMs ?? this.retryDefaults.maxDelayMs,
    };
    for (const [field, value] of Object.entries(config)) {
      if (!Number.isSafeInteger(value) || value < (field === "maxAttempts" ? 1 : 0)) {
        throw new TypeError(`${field} has an invalid retry value`);
      }
    }
    return config;
  }

  async _execute(input, init = {}, throwOnExhausted = false, recordRequest = true) {
    const config = this._retryConfig(init);
    if (init.body !== undefined && typeof init.body !== "string") {
      try {
        assertJsonValue(init.body, "request body");
      } catch (error) {
        return errorResponse(400, "0x80060888", error.message);
      }
    }
    const headers = new TwinHeaders(init.headers);
    let logicalId = headers.get("x-logical-request-id");
    if (!logicalId) {
      do {
        this.automaticRequestCounter += 1n;
        logicalId = `logical-${String(this.automaticRequestCounter).padStart(6, "0")}`;
      } while (this.usedLogicalRequestIds.has(logicalId));
      headers.set("x-logical-request-id", logicalId);
    }
    this.usedLogicalRequestIds.add(logicalId);
    const normalizedInit = { ...init, headers: headers.toObject() };
    let operation = null;
    if (recordRequest) {
      const serialized = serializeRequest(
        input,
        normalizedInit,
        logicalId,
        throwOnExhausted,
      );
      this.requestLog.push(clone(serialized));
      operation = { kind: "request", request: clone(serialized) };
      this.runLog.push(operation);
    }
    const completeResponse = (response) => {
      if (operation) {
        operation.outcome = { kind: "response", response: responseSnapshot(response) };
      }
      return response;
    };
    try {
      let lastResponse = null;
      let lastError = null;
      for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
        try {
          const response = await this._attempt(input, normalizedInit, logicalId, attempt);
          lastResponse = response;
          lastError = null;
          if (!RETRYABLE_STATUS.has(response.status)) return completeResponse(response);
          if (attempt === config.maxAttempts) break;
          const advised = Number(response.headers.get("retry-after-ms"));
          const delay = Number.isSafeInteger(advised)
            ? advised
            : Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
          this.clock.advance(delay);
          this._event("retry", { logicalRequestId: logicalId, attempt, delay, status: response.status });
        } catch (error) {
          if (!(error instanceof TwinTransportError)) throw error;
          lastError = error;
          lastResponse = null;
          if (attempt === config.maxAttempts) break;
          const delay = Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
          this.clock.advance(delay);
          this._event("retry", {
            logicalRequestId: logicalId,
            attempt,
            delay,
            transportCode: error.code,
          });
        }
      }
      if (lastError) {
        throw new TwinRetryExhaustedError(
          `retry policy exhausted after ${config.maxAttempts} attempt(s)`,
          config.maxAttempts,
          null,
          lastError,
        );
      }
      if (throwOnExhausted && lastResponse) {
        throw new TwinRetryExhaustedError(
          `retry policy exhausted with HTTP ${lastResponse.status}`,
          config.maxAttempts,
          lastResponse,
        );
      }
      return completeResponse(lastResponse);
    } catch (error) {
      if (operation) operation.outcome = { kind: "error", error: errorSnapshot(error) };
      throw error;
    }
  }

  async fetch(input, init = {}) {
    return this._execute(input, init, false, true);
  }

  async request(input, init = {}) {
    return this._execute(input, init, true, true);
  }

  async deleteMany(entity, records, init = {}) {
    return this.fetch(`/api/data/v9.2/${entity}`, {
      ...init,
      method: "DELETE",
      body: { records },
    });
  }

  injectableFetch() {
    return this.fetch.bind(this);
  }

  advanceTime(milliseconds, options = {}) {
    const now = this.clock.advance(milliseconds);
    if (options.record !== false) {
      this.runLog.push({ kind: "advance-time", milliseconds });
    }
    this._event("time-advanced", { milliseconds, now });
    return now;
  }

  reset(options = {}) {
    this.resetGeneration += 1;
    this._restoreSeed();
    this.clock.reset();
    this.setFaultPlan(this.faultTemplate, { record: false });
    if (options.record !== false) this.runLog.push({ kind: "reset" });
    this._event("reset", {
      seedDigest: this.seedDigest,
      resetGeneration: this.resetGeneration,
      revision: this.revisionCounter,
    });
    return this.stateDigest();
  }

  state() {
    const entities = {};
    for (const entity of Object.keys(ENTITY_DEFINITIONS).sort(codeUnitCompare)) {
      entities[entity] = this._records(entity).map(clone);
    }
    return {
      epoch: this.initialSeed.epoch,
      now: this.clock.now(),
      lineage: {
        resetGeneration: this.resetGeneration,
        revision: this.revisionCounter,
        creationOrdinal: this.creationCounter,
      },
      entities,
    };
  }

  validateIntegrity() {
    const seenIds = new Set();
    for (const entity of Object.keys(ENTITY_DEFINITIONS)) {
      const definition = ENTITY_DEFINITIONS[entity];
      for (const record of this._records(entity)) {
        const id = normalizedRecordId(record[definition.id]);
        if (seenIds.has(id)) throw new TypeError(`duplicate runtime id ${id}`);
        seenIds.add(id);
        const actualProperties = Object.keys(record)
          .filter((field) => !field.startsWith("@") && !field.includes("@OData."));
        const expectedProperties = Object.keys(definition.schema.fields);
        if (
          actualProperties.sort(codeUnitCompare).join("\0") !==
          expectedProperties.sort(codeUnitCompare).join("\0")
        ) {
          throw new TypeError(`${entity}(${id}) properties differ from its schema`);
        }
        for (const [field, type] of Object.entries(definition.fields)) {
          if (record[field] === undefined) {
            if (!type.endsWith("?")) throw new TypeError(`${entity}.${field} is missing`);
            continue;
          }
          validateFieldType(
            field,
            type,
            record[field],
            definition.schema.fields[field],
          );
          validateFieldConstraints(entity, field, record[field]);
        }
        validateRequiredFields(entity, record);
        if (definition.schema.fields.exchangerate) {
          const currency = this._lookup(
            "transactioncurrencies",
            record.transactioncurrencyid,
          );
          if (
            !currency ||
            decimalUnits(currency.exchangerate, 6) <= 0n ||
            record.exchangerate !== currency.exchangerate
          ) {
            throw new TypeError(`${entity} has a stale transaction exchange rate`);
          }
        }
        const expected = clone(record);
        this._decorateLookups(entity, expected);
        if (canonicalStringify(expected) !== canonicalStringify(record)) {
          throw new TypeError(`${entity}(${id}) has stale denormalized lookup data`);
        }
        const revision = this.revisions[entity].get(id);
        if (
          !Number.isSafeInteger(revision) ||
          record["@odata.etag"] !== recordEtag(record, revision, this.resetGeneration)
        ) {
          throw new TypeError(`${entity}(${id}) has an invalid runtime ETag`);
        }
      }
    }
    for (const product of this._records("products")) {
      const unit = this._lookup("uoms", product.defaultuomid);
      if (!unit || unit.uomscheduleid !== product.defaultuomscheduleid) {
        throw new TypeError("product default UOM is outside its unit group");
      }
    }
    for (const currency of this._records("transactioncurrencies")) {
      if (decimalUnits(currency.exchangerate, 6) <= 0n) {
        throw new TypeError("transaction currency exchange rate must be positive");
      }
    }
    for (const price of this._records("productpricelevels")) {
      const priceList = this._lookup("pricelevels", price.pricelevelid);
      const product = this._lookup("products", price.productid);
      const unit = this._lookup("uoms", price.uomid);
      if (
        !priceList ||
        !product ||
        !unit ||
        price.transactioncurrencyid !== priceList.transactioncurrencyid ||
        unit.uomscheduleid !== product.defaultuomscheduleid
      ) {
        throw new TypeError("product price level currency or UOM is inconsistent");
      }
    }
    const pairs = new Map();
    for (const record of this._records("connections")) {
      const pair = pairs.get(record.connectionpairid) || [];
      pair.push(record);
      pairs.set(record.connectionpairid, pair);
    }
    for (const [pairId, pair] of pairs) {
      if (pair.length !== 2) throw new TypeError(`connection pair ${pairId} is incomplete`);
      const [left, right] = pair;
      if (
        left.record1id !== right.record2id ||
        left.record2id !== right.record1id ||
        left.record1type !== right.record2type ||
        left.record2type !== right.record1type ||
        left.record1roleidname !== right.record2roleidname ||
        left.record2roleidname !== right.record1roleidname ||
        left.description !== right.description ||
        left.effectivestart !== right.effectivestart ||
        left.effectiveend !== right.effectiveend ||
        left.statecode !== right.statecode ||
        left.statuscode !== right.statuscode ||
        left.ownerid !== right.ownerid
      ) {
        throw new TypeError(`connection pair ${pairId} is not reciprocal`);
      }
    }
    for (const [lineEntity, contract] of Object.entries(SALES_LINE_CONTRACTS)) {
      const lines = this._records(lineEntity);
      for (const line of lines) {
        const base = multiplyDecimal(line.quantity, 2, line.priceperunit, 2);
        const extended =
          decimalUnits(base, 2) -
          decimalUnits(line.manualdiscountamount, 2) +
          decimalUnits(line.tax, 2);
        const parent = this._lookup(
          contract.parentEntity,
          line[contract.parentField],
        );
        const priceLevel = parent
          ? this._lookup("pricelevels", parent.pricelevelid)
          : null;
        const currency = parent
          ? this._lookup("transactioncurrencies", parent.transactioncurrencyid)
          : null;
        const productPrice = parent
          ? this._records("productpricelevels").find(
              (price) =>
                price.productid === line.productid &&
                price.pricelevelid === parent.pricelevelid &&
                price.uomid === line.uomid &&
                price.transactioncurrencyid === parent.transactioncurrencyid,
            )
          : null;
        if (
          !parent ||
          !priceLevel ||
          priceLevel.statecode !== 0 ||
          !currency ||
          currency.statecode !== 0 ||
          priceLevel.transactioncurrencyid !== parent.transactioncurrencyid ||
          !productPrice ||
          decimalUnits(line.quantity, 2) <= 0n ||
          extended < 0n ||
          line.baseamount !== base ||
          line.extendedamount !== decimalText(extended, 2) ||
          line.transactioncurrencyid !== parent.transactioncurrencyid ||
          line.exchangerate !== parent.exchangerate
        ) {
          throw new TypeError(
            `${lineEntity} has invalid pricing, arithmetic, or parent currency`,
          );
        }
      }
      for (const parent of this._records(contract.parentEntity)) {
        const priceLevel = this._lookup("pricelevels", parent.pricelevelid);
        const currency = this._lookup(
          "transactioncurrencies",
          parent.transactioncurrencyid,
        );
        if (
          !priceLevel ||
          priceLevel.statecode !== 0 ||
          !currency ||
          currency.statecode !== 0 ||
          priceLevel.transactioncurrencyid !== parent.transactioncurrencyid
        ) {
          throw new TypeError(
            `${contract.parentEntity} has an inactive or mismatched price list`,
          );
        }
        const expected = clone(parent);
        this._applyDocumentTotals(
          expected,
          lines.filter(
            (line) =>
              line[contract.parentField] ===
              parent[ENTITY_DEFINITIONS[contract.parentEntity].id],
          ),
        );
        for (const field of [
          "totallineitemamount",
          "totaldiscountamount",
          "totaltax",
          "totalamount",
        ]) {
          if (expected[field] !== parent[field]) {
            throw new TypeError(`${contract.parentEntity} has stale line totals`);
          }
        }
      }
    }
    for (const requirement of this._records("msdyn_resourcerequirements")) {
      const start = new Date(requirement.msdyn_fromdate).valueOf();
      const end = new Date(requirement.msdyn_todate).valueOf();
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start >= end
      ) {
        throw new TypeError("resource requirement has an invalid window");
      }
    }
    const intervals = new Map();
    for (const booking of this._records("bookableresourcebookings")) {
      const status = this._lookup("bookingstatuses", booking.bookingstatus);
      if (!status) throw new TypeError("booking status does not resolve");
      const requirement = this._lookup(
        "msdyn_resourcerequirements",
        booking.msdyn_resourcerequirement,
      );
      const resource = this._lookup("bookableresources", booking.resource);
      const start = new Date(booking.starttime).valueOf();
      const end = new Date(booking.endtime).valueOf();
      const requirementStart = new Date(requirement?.msdyn_fromdate).valueOf();
      const requirementEnd = new Date(requirement?.msdyn_todate).valueOf();
      if (
        !requirement ||
        requirement.msdyn_workorder !== booking.msdyn_workorder ||
        !resource ||
        start >= end ||
        (end - start) / 60000 !== booking.duration ||
        start < requirementStart ||
        end > requirementEnd ||
        (booking.statecode === 0 &&
          (resource.statecode !== 0 || requirement.statecode !== 0)) ||
        (booking.statecode === 0 && status.msdyn_statuscompletesworkorder) ||
        (booking.statecode === 1 && !status.msdyn_statuscompletesworkorder)
      ) {
        throw new TypeError("booking state, resource, or requirement window is inconsistent");
      }
      if (status.msdyn_fieldservicestatus === 690970004) continue;
      const rows = intervals.get(booking.resource) || [];
      rows.push([
        start,
        end,
        booking.bookableresourcebookingid,
      ]);
      intervals.set(booking.resource, rows);
    }
    for (const rows of intervals.values()) {
      rows.sort((left, right) => left[0] - right[0] || codeUnitCompare(left[2], right[2]));
      for (let index = 1; index < rows.length; index += 1) {
        if (rows[index - 1][1] > rows[index][0]) {
          throw new TypeError("resource bookings overlap");
        }
      }
    }
    for (const workorder of this._records("msdyn_workorders")) {
      const requirements = this._records("msdyn_resourcerequirements").filter(
        (requirement) =>
          requirement.msdyn_workorder === workorder.msdyn_workorderid &&
          requirement.msdyn_isprimary,
      );
      if (requirements.length !== 1) {
        throw new TypeError("work order must have one primary requirement");
      }
      const asset = this._lookup(
        "msdyn_customerassets",
        workorder.msdyn_customerasset,
      );
      const serviceRequest = this._lookup(
        "incidents",
        workorder.msdyn_servicerequest,
      );
      const account =
        serviceRequest?.customeridtype === "accounts"
          ? serviceRequest.customerid
          : this._lookup(
              "contacts",
              serviceRequest?.customerid,
            )?.parentcustomerid;
      if (
        !asset ||
        !serviceRequest ||
        asset.msdyn_account !== workorder.msdyn_serviceaccount ||
        account !== workorder.msdyn_serviceaccount
      ) {
        throw new TypeError(
          "work order service request, asset, and account are inconsistent",
        );
      }
      const terminal = TERMINAL_WORK_ORDER_STATUSES.has(
        workorder.msdyn_systemstatus,
      );
      if (
        (terminal && workorder.statecode !== 1) ||
        (!terminal && workorder.statecode !== 0)
      ) {
        throw new TypeError("work order system status and state are inconsistent");
      }
      const workOrderChildren = [
        "msdyn_resourcerequirements",
        "msdyn_workorderservicetasks",
        "msdyn_workorderproducts",
        "msdyn_workorderservices",
        "msdyn_workorderincidents",
      ].flatMap((entity) =>
        this._records(entity)
          .filter((record) => record.msdyn_workorder === workorder.msdyn_workorderid)
          .map((record) => ({ entity, record })),
      );
      for (const { entity, record } of workOrderChildren) {
        if (
          entity === "msdyn_workorderservicetasks" &&
          record.statecode === 1 &&
          record.msdyn_percentcomplete !== 100
        ) {
          throw new TypeError("inactive work order tasks must be complete");
        }
        if (entity === "msdyn_workorderincidents") {
          if (
            record.msdyn_customerasset &&
            record.msdyn_customerasset !== workorder.msdyn_customerasset
          ) {
            throw new TypeError("work order incident asset differs from its parent");
          }
        }
        if (entity === "msdyn_workorderproducts") {
          const product = this._lookup("products", record.msdyn_product);
          const unit = this._lookup("uoms", record.msdyn_unit);
          if (
            !product ||
            !unit ||
            product.producttypecode === 3 ||
            unit.uomscheduleid !== product.defaultuomscheduleid ||
            record.transactioncurrencyid !== product.transactioncurrencyid
          ) {
            throw new TypeError("work order product catalog values are inconsistent");
          }
        }
        if (entity === "msdyn_workorderservices") {
          const service = this._lookup("products", record.msdyn_service);
          if (
            !service ||
            service.producttypecode !== 3 ||
            record.transactioncurrencyid !== service.transactioncurrencyid
          ) {
            throw new TypeError("work order service currency is inconsistent");
          }
        }
      }
      if (terminal) {
        const activeBookings = this._records("bookableresourcebookings").filter(
          (booking) =>
            booking.msdyn_workorder === workorder.msdyn_workorderid &&
            booking.statecode === 0,
        );
        const incompleteTasks = this._records(
          "msdyn_workorderservicetasks",
        ).filter(
          (task) =>
            task.msdyn_workorder === workorder.msdyn_workorderid &&
            task.msdyn_percentcomplete !== 100,
        );
        const activeChildren = workOrderChildren.filter(
          ({ record }) => record.statecode === 0,
        );
        if (
          activeBookings.length ||
          incompleteTasks.length ||
          activeChildren.length
        ) {
          throw new TypeError("terminal work order has active work");
        }
      }
    }
    return true;
  }

  stateDigest() {
    return sha256(canonicalStringify(this.state()));
  }

  contentDigest() {
    const content = clone(this.state());
    delete content.now;
    delete content.lineage;
    for (const records of Object.values(content.entities)) {
      for (const record of records) delete record["@odata.etag"];
    }
    return sha256(canonicalStringify(content));
  }

  traceDigest() {
    return sha256(canonicalStringify(this.trace));
  }

  exportRun() {
    return {
      schemaVersion: 3,
      seed: clone(this.initialSeed),
      epoch: this.clock.initial,
      retry: clone(this.retryDefaults),
      faults: clone(this.faultTemplate),
      requests: clone(this.requestLog),
      operations: clone(this.runLog),
      finalStateDigest: this.stateDigest(),
      finalContentDigest: this.contentDigest(),
      traceDigest: this.traceDigest(),
      now: this.clock.now(),
      lineage: clone(this.state().lineage),
    };
  }

  async replay(run) {
    return replayRun(run);
  }
}

export async function replayRun(run) {
  assertJsonValue(run, "run export");
  if (
    !run ||
    ![1, 2, 3].includes(run.schemaVersion) ||
    !Array.isArray(run.requests) ||
    !run.seed
  ) {
    throw new TypeError("run export is not supported");
  }
  const twin = new TwinCore({
    seed: run.seed,
    epoch: run.epoch,
    retry: run.retry,
    faults: run.faults,
  });
  const operations = Array.isArray(run.operations)
    ? run.operations
    : run.requests.map((request) => ({ kind: "request", request }));
  for (const [operationIndex, operation] of operations.entries()) {
    if (operation.kind === "request") {
      const request = deserializeRequest(operation.request);
      let thrown = null;
      try {
        await twin._execute(
          request.input,
          request.init,
          request.mode === "request",
          true,
        );
      } catch (error) {
        thrown = error;
      }
      const actualOperation = twin.runLog[twin.runLog.length - 1];
      const actualOutcome = actualOperation?.outcome;
      if (
        operation.outcome &&
        canonicalStringify(actualOutcome) !== canonicalStringify(operation.outcome)
      ) {
        throw new TwinReplayDivergenceError(
          `replay divergence at operation ${operationIndex}: expected ${canonicalStringify(operation.outcome)}, received ${canonicalStringify(actualOutcome)}`,
          operationIndex,
        );
      }
      if (thrown && !operation.outcome) throw thrown;
    } else if (operation.kind === "fault-plan") {
      twin.setFaultPlan(operation.plans);
    } else if (operation.kind === "clear-faults") {
      twin.clearFaults();
    } else if (operation.kind === "advance-time") {
      twin.advanceTime(operation.milliseconds);
    } else if (operation.kind === "reset") {
      twin.reset();
    } else {
      throw new TypeError(`unsupported replay operation: ${operation.kind}`);
    }
  }
  for (const [label, expected, actual] of [
    ["state digest", run.finalStateDigest, twin.stateDigest()],
    ["content digest", run.finalContentDigest, twin.contentDigest()],
    ["trace digest", run.traceDigest, twin.traceDigest()],
    ["virtual clock", run.now, twin.clock.now()],
  ]) {
    if (expected !== undefined && expected !== actual) {
      throw new TwinReplayDivergenceError(
        `replay divergence in ${label}: expected ${expected}, received ${actual}`,
      );
    }
  }
  return twin;
}

export function diffStates(before = {}, after = {}) {
  const changes = [];
  const beforeEntities = before.entities || {};
  const afterEntities = after.entities || {};
  for (const entity of new Set([...Object.keys(beforeEntities), ...Object.keys(afterEntities)])) {
    const definition = ENTITY_DEFINITIONS[entity];
    if (!definition) continue;
    const idField = definition.id;
    const left = new Map((beforeEntities[entity] || []).map((record) => [record[idField], record]));
    const right = new Map((afterEntities[entity] || []).map((record) => [record[idField], record]));
    for (const id of [...new Set([...left.keys(), ...right.keys()])].sort(codeUnitCompare)) {
      if (!left.has(id)) changes.push({ entity, id, kind: "created", after: clone(right.get(id)) });
      else if (!right.has(id)) changes.push({ entity, id, kind: "deleted", before: clone(left.get(id)) });
      else if (canonicalStringify(left.get(id)) !== canonicalStringify(right.get(id))) {
        changes.push({
          entity,
          id,
          kind: "updated",
          before: clone(left.get(id)),
          after: clone(right.get(id)),
        });
      }
    }
  }
  return changes;
}

async function scenarioCrud(twin) {
  const createdResponse = await twin.fetch("/api/data/v9.2/accounts", {
    method: "POST",
    headers: {
      prefer: "return=representation",
      "x-logical-request-id": "scenario-account-create",
    },
    body: { name: "Prairie Lantern Supply" },
  });
  const created = await createdResponse.json();
  const readResponse = await twin.fetch(
    `/api/data/v9.2/accounts(${created.accountid})`,
  );
  const response = await twin.fetch(`/api/data/v9.2/accounts(${created.accountid})`, {
    method: "PATCH",
    headers: {
      "if-match": created["@odata.etag"],
      prefer: "return=representation",
      "x-logical-request-id": "scenario-account-update",
    },
    body: { description: "Scenario update." },
  });
  return {
    createStatus: createdResponse.status,
    readStatus: readResponse.status,
    updateStatus: response.status,
    id: created.accountid,
    stateDigest: twin.stateDigest(),
  };
}

async function scenarioRetry(twin) {
  twin.setFaultPlan([{ type: "http-503", times: 2, retryAfterMs: 250 }]);
  const response = await twin.fetch("/api/data/v9.2/accounts?$top=1", {
    retry: { maxAttempts: 3, baseDelayMs: 250 },
  });
  return { status: response.status, now: twin.clock.now() };
}

async function scenarioTime(twin) {
  const before = twin.clock.now();
  const after = twin.advanceTime(2 * 86400000);
  return { before, after };
}

export const BUILT_IN_SCENARIOS = Object.freeze([
  Object.freeze({ id: "crud", name: "Create, read, update", run: scenarioCrud }),
  Object.freeze({ id: "retry", name: "Transient outage and retry", run: scenarioRetry }),
  Object.freeze({ id: "virtual-time", name: "Advance virtual time", run: scenarioTime }),
]);

export async function runBuiltInScenario(twin, scenarioId) {
  const scenario = BUILT_IN_SCENARIOS.find((item) => item.id === scenarioId);
  if (!scenario) throw new TypeError(`unknown scenario: ${scenarioId}`);
  const before = twin.state();
  const result = await scenario.run(twin);
  return { scenario: scenario.id, result, changes: diffStates(before, twin.state()) };
}

export function createTwin(options = {}) {
  return new TwinCore(options);
}
