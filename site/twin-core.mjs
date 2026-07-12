const API_MARKER = "/api/data/v9.2/";
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const MUTATION_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const RETRYABLE_STATUS = new Set([429, 503]);
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;

export const CASE_STATUS_REASONS = Object.freeze({
  0: Object.freeze({ 1: "In Progress", 2: "On Hold", 3: "Waiting for Details", 4: "Researching" }),
  1: Object.freeze({ 5: "Problem Solved", 1000: "Information Provided" }),
  2: Object.freeze({ 6: "Canceled", 2000: "Merged" }),
});
const CASE_PRIORITY_LABELS = Object.freeze({ 1: "High", 2: "Normal", 3: "Low" });
const CASE_ORIGIN_LABELS = Object.freeze({ 1: "Phone", 2: "Email", 3: "Web" });
const CASE_TYPE_LABELS = Object.freeze({ 1: "Question", 2: "Problem", 3: "Request" });
const CASE_STATE_LABELS = Object.freeze({ 0: "Active", 1: "Resolved", 2: "Canceled" });
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

const commonFields = {
  ownerid: "guid",
  owneridname: "string",
  createdon: "datetime",
  modifiedon: "datetime",
  statecode: "integer",
  statuscode: "integer",
};

export const ENTITY_DEFINITIONS = Object.freeze({
  accounts: Object.freeze({
    id: "accountid",
    required: Object.freeze(["name"]),
    statePairs: Object.freeze(["0:1", "1:2"]),
    discriminators: Object.freeze({}),
    ranges: Object.freeze({}),
    fields: Object.freeze({
      ...commonFields,
      name: "string",
      accountnumber: "string",
      telephone1: "string?",
      emailaddress1: "string?",
      websiteurl: "url?",
      address1_line1: "string?",
      address1_city: "string?",
      address1_stateorprovince: "string?",
      address1_postalcode: "string?",
      address1_country: "string?",
      industrycode: "string?",
      description: "string?",
      primarycontactid: "guid?",
      primarycontactidname: "string?",
    }),
  }),
  contacts: Object.freeze({
    id: "contactid",
    required: Object.freeze(["firstname", "lastname", "parentcustomerid"]),
    statePairs: Object.freeze(["0:1", "1:2"]),
    discriminators: Object.freeze({}),
    ranges: Object.freeze({ preferredcontactmethodcode: Object.freeze([1, 5]) }),
    fields: Object.freeze({
      ...commonFields,
      firstname: "string",
      lastname: "string",
      fullname: "string",
      emailaddress1: "string?",
      telephone1: "string?",
      jobtitle: "string?",
      parentcustomerid: "guid",
      parentcustomeridname: "string",
      address1_city: "string?",
      address1_stateorprovince: "string?",
      preferredcontactmethodcode: "integer",
    }),
  }),
  incidents: Object.freeze({
    id: "incidentid",
    required: Object.freeze(["title", "customerid", "customeridtype", "primarycontactid"]),
    statePairs: Object.freeze([
      "0:1", "0:2", "0:3", "0:4", "1:5", "1:1000", "2:6", "2:2000",
    ]),
    discriminators: Object.freeze({
      customeridtype: Object.freeze(["accounts", "contacts"]),
    }),
    ranges: Object.freeze({
      prioritycode: Object.freeze([1, 3]),
      caseorigincode: Object.freeze([1, 3]),
      casetypecode: Object.freeze([1, 3]),
    }),
    fields: Object.freeze({
      ...commonFields,
      ticketnumber: "string",
      title: "string",
      description: "string?",
      customerid: "guid",
      customeridname: "string",
      customeridtype: "entity",
      primarycontactid: "guid",
      primarycontactidname: "string",
      prioritycode: "integer",
      caseorigincode: "integer",
      casetypecode: "integer",
      resolveby: "datetime?",
      firstresponsesenton: "datetime?",
      resolvedon: "datetime?",
    }),
  }),
  tasks: Object.freeze({
    id: "activityid",
    required: Object.freeze(["subject", "scheduledend", "regardingobjectid"]),
    statePairs: Object.freeze(["0:2", "0:3", "1:5", "2:6"]),
    discriminators: Object.freeze({
      regardingobjectidtype: Object.freeze(["accounts", "contacts", "incidents"]),
    }),
    ranges: Object.freeze({
      prioritycode: Object.freeze([1, 3]),
      percentcomplete: Object.freeze([0, 100]),
    }),
    fields: Object.freeze({
      ...commonFields,
      subject: "string",
      description: "string?",
      regardingobjectid: "guid",
      regardingobjectidname: "string",
      regardingobjectidtype: "entity",
      scheduledend: "datetime",
      actualend: "datetime?",
      prioritycode: "integer",
      percentcomplete: "integer",
    }),
  }),
  emails: Object.freeze({
    id: "activityid",
    required: Object.freeze([
      "subject",
      "directioncode",
      "fromaddress",
      "toaddress",
      "senderid",
      "senderidtype",
      "recipientid",
      "recipientidtype",
      "regardingobjectid",
    ]),
    statePairs: Object.freeze(["1:3", "1:4"]),
    discriminators: Object.freeze({
      senderidtype: Object.freeze(["accounts", "contacts", "systemusers"]),
      recipientidtype: Object.freeze(["accounts", "contacts", "systemusers"]),
      regardingobjectidtype: Object.freeze(["accounts", "contacts", "incidents"]),
    }),
    ranges: Object.freeze({}),
    fields: Object.freeze({
      ...commonFields,
      subject: "string",
      description: "string?",
      directioncode: "boolean",
      fromaddress: "string",
      fromname: "string",
      toaddress: "string",
      toname: "string",
      senderid: "guid",
      senderidname: "string",
      senderidtype: "entity",
      recipientid: "guid",
      recipientidname: "string",
      recipientidtype: "entity",
      regardingobjectid: "guid",
      regardingobjectidname: "string",
      regardingobjectidtype: "entity",
      scheduledstart: "datetime?",
      senton: "datetime?",
    }),
  }),
  connections: Object.freeze({
    id: "connectionid",
    required: Object.freeze(["record1id", "record2id", "record1type", "record2type"]),
    statePairs: Object.freeze(["0:1", "1:2"]),
    discriminators: Object.freeze({
      record1type: Object.freeze(["contacts"]),
      record2type: Object.freeze(["contacts"]),
    }),
    ranges: Object.freeze({}),
    fields: Object.freeze({
      ...commonFields,
      connectionpairid: "guid",
      record1id: "guid",
      record1idname: "string",
      record1type: "entity",
      record2id: "guid",
      record2idname: "string",
      record2type: "entity",
      record1roleidname: "string?",
      record2roleidname: "string?",
      description: "string?",
      effectivestart: "datetime?",
      effectiveend: "datetime?",
    }),
  }),
});

const READ_ONLY_FIELDS = new Set([
  "accountid",
  "contactid",
  "incidentid",
  "activityid",
  "connectionid",
  "connectionpairid",
  "createdon",
  "modifiedon",
  "owneridname",
  "primarycontactidname",
  "fullname",
  "parentcustomeridname",
  "customeridname",
  "primarycontactidname",
  "regardingobjectidname",
  "senderidname",
  "recipientidname",
  "fromname",
  "toname",
  "record1idname",
  "record2idname",
  "resolvedon",
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

function validateFieldType(field, type, value) {
  const nullable = type.endsWith("?");
  const base = nullable ? type.slice(0, -1) : type;
  if (value === null) {
    if (nullable) return null;
    throw new TypeError(`${field} cannot be null`);
  }
  if (base === "string" && typeof value === "string") return value;
  if (base === "boolean" && typeof value === "boolean") return value;
  if (base === "integer" && Number.isSafeInteger(value)) return value;
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

function validatePayload(entity, body, method) {
  const definition = ENTITY_DEFINITIONS[entity];
  const clean = {};
  for (const [field, value] of Object.entries(body)) {
    if (field.startsWith("@") || field.includes("@OData.")) {
      throw new TypeError(`${field} is an annotation and cannot be written`);
    }
    if (READ_ONLY_FIELDS.has(field) || field === definition.id) {
      throw new TypeError(`${field} is read-only`);
    }
    const type = definition.fields[field];
    if (!type) throw new TypeError(`${field} is not valid for ${entity}`);
    clean[field] = validateFieldType(field, type, value);
    const allowedDiscriminators = definition.discriminators[field];
    if (allowedDiscriminators && !allowedDiscriminators.includes(clean[field])) {
      throw new TypeError(
        `${field} must be one of ${allowedDiscriminators.join(", ")}`,
      );
    }
    const range = definition.ranges[field];
    if (range && (clean[field] < range[0] || clean[field] > range[1])) {
      throw new TypeError(`${field} must be between ${range[0]} and ${range[1]}`);
    }
  }
  if (method === "POST" && Object.keys(clean).length === 0) {
    throw new TypeError("create payload cannot be empty");
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
  if (!ENTITY_DEFINITIONS[entity].statePairs.includes(stateVector)) {
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
      if (operator === "eq") return actual === expected;
      if (operator === "ne") return actual !== expected;
      if (actual === null || expected === null) return false;
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
    entity: "Edm.String",
    guid: "Edm.Guid",
    integer: "Edm.Int32",
    string: "Edm.String",
    url: "Edm.String",
  }[base];
  return type ? { type, nullable } : null;
}

function normalizeSeed(seed) {
  assertJsonValue(seed, "seed");
  if (
    !seed ||
    typeof seed !== "object" ||
    seed.schemaVersion !== 2 ||
    !seed.entities ||
    !seed.epoch ||
    !seed.identity ||
    !seed.metadata
  ) {
    throw new TypeError("seed must use schemaVersion 2 and include identity, metadata, epoch, and entities");
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
    ["schemaVersion", "epoch", "tenant", "identities", "identity", "metadata", "entities"],
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
  if (!Array.isArray(normalized.identities) || !normalized.identities.length) {
    throw new TypeError("seed must include at least one identity");
  }
  const identityIds = new Set();
  for (const [index, identity] of normalized.identities.entries()) {
    exactKeys(identity, ["systemuserid", "fullname", "title"], `seed identity ${index}`);
    if (
      !identity ||
      typeof identity !== "object" ||
      typeof identity.fullname !== "string" ||
      !identity.fullname.trim() ||
      typeof identity.title !== "string" ||
      !identity.title.trim()
    ) {
      throw new TypeError(`seed identity ${index} is malformed`);
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
    identity.systemuserid = normalizedRecordId(identity.systemuserid);
    if (identityIds.has(identity.systemuserid)) throw new TypeError("seed identity ids must be unique");
    identityIds.add(identity.systemuserid);
  }
  for (const field of ["BusinessUnitId", "OrganizationId", "UserId"]) {
    normalized.identity[field] = normalizedRecordId(normalized.identity[field]);
  }
  if (
    normalized.identity.UserId !== normalized.identities[0].systemuserid ||
    normalized.identity.FullName !== normalized.identities[0].fullname ||
    normalized.identity.OrganizationUrl !== normalized.tenant?.organizationUrl ||
    normalized.identity.Version !== normalized.tenant.organizationVersion ||
    normalized.identity["@odata.context"] !==
      `${normalized.tenant.organizationUrl}/api/data/v9.2/$metadata#Microsoft.Dynamics.CRM.WhoAmIResponse`
  ) {
    throw new TypeError("seed identity does not match the canonical tenant identity");
  }
  const entityNames = Object.keys(ENTITY_DEFINITIONS).sort(codeUnitCompare);
  if (
    Object.keys(normalized.entities).sort(codeUnitCompare).join("\0") !==
    entityNames.join("\0")
  ) {
    throw new TypeError("seed entity sets do not match the runtime schema");
  }
  const idsByEntity = {};
  for (const entity of Object.keys(ENTITY_DEFINITIONS)) {
    if (!Array.isArray(normalized.entities[entity])) {
      throw new TypeError(`seed is missing ${entity}`);
    }
    const idField = ENTITY_DEFINITIONS[entity].id;
    const ids = new Set();
    for (const record of normalized.entities[entity]) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new TypeError(`seed ${entity} record must be an object`);
      }
      const allowed = new Set([
        idField,
        "@odata.etag",
        ...Object.keys(ENTITY_DEFINITIONS[entity].fields),
      ]);
      for (const [field, value] of Object.entries(record)) {
        if (field.includes("@OData.Community.Display.V1.FormattedValue")) {
          const base = field.split("@", 1)[0];
          if (!allowed.has(base) || typeof value !== "string") {
            throw new TypeError(`seed ${entity} annotation ${field} is invalid`);
          }
          continue;
        }
        if (!allowed.has(field)) throw new TypeError(`seed ${entity} field ${field} is undeclared`);
      }
      const id = normalizedRecordId(record[idField]);
      if (ids.has(id)) throw new TypeError(`seed has duplicate ${entity} id ${id}`);
      record[idField] = id;
      ids.add(id);
      for (const [field, type] of Object.entries(ENTITY_DEFINITIONS[entity].fields)) {
        if (record[field] === undefined) {
          if (!type.endsWith("?")) throw new TypeError(`seed ${entity}.${field} is required`);
          continue;
        }
        record[field] = validateFieldType(field, type, record[field]);
        const allowedDiscriminators = ENTITY_DEFINITIONS[entity].discriminators[field];
        if (allowedDiscriminators && !allowedDiscriminators.includes(record[field])) {
          throw new TypeError(`seed ${entity}.${field} has an invalid discriminator`);
        }
        const range = ENTITY_DEFINITIONS[entity].ranges[field];
        if (range && (record[field] < range[0] || record[field] > range[1])) {
          throw new TypeError(`seed ${entity}.${field} is outside its declared range`);
        }
      }
      validateRequiredFields(entity, record);
    }
    normalized.entities[entity].sort((a, b) => codeUnitCompare(a[idField], b[idField]));
    idsByEntity[entity] = ids;
  }
  const has = (entity, id) =>
    entity === "systemusers" ? identityIds.has(id) : idsByEntity[entity]?.has(id);
  for (const record of normalized.entities.accounts) {
    if (!has("systemusers", record.ownerid)) throw new TypeError("seed account owner does not resolve");
    if (record.primarycontactid && !has("contacts", record.primarycontactid)) {
      throw new TypeError("seed account primary contact does not resolve");
    }
  }
  for (const record of normalized.entities.contacts) {
    if (!has("accounts", record.parentcustomerid)) throw new TypeError("seed contact parent does not resolve");
    if (!has("systemusers", record.ownerid)) throw new TypeError("seed contact owner does not resolve");
  }
  for (const record of normalized.entities.incidents) {
    if (!has(record.customeridtype, record.customerid)) throw new TypeError("seed case customer does not resolve");
    if (!has("contacts", record.primarycontactid)) throw new TypeError("seed case primary contact does not resolve");
    if (!has("systemusers", record.ownerid)) throw new TypeError("seed case owner does not resolve");
  }
  for (const entity of ["tasks", "emails"]) {
    for (const record of normalized.entities[entity]) {
      if (!has(record.regardingobjectidtype, record.regardingobjectid)) {
        throw new TypeError(`seed ${entity} regarding lookup does not resolve`);
      }
      if (!has("systemusers", record.ownerid)) throw new TypeError(`seed ${entity} owner does not resolve`);
      if (entity === "emails") {
        if (!has(record.senderidtype, record.senderid) || !has(record.recipientidtype, record.recipientid)) {
          throw new TypeError("seed email party lookup does not resolve");
        }
      }
    }
  }
  const connectionsByPair = new Map();
  for (const record of normalized.entities.connections) {
    if (!has(record.record1type, record.record1id) || !has(record.record2type, record.record2id)) {
      throw new TypeError("seed connection endpoint does not resolve");
    }
    const pair = connectionsByPair.get(record.connectionpairid) || [];
    pair.push(record);
    connectionsByPair.set(record.connectionpairid, pair);
  }
  for (const pair of connectionsByPair.values()) {
    if (
      pair.length !== 2 ||
      pair[0].record1id !== pair[1].record2id ||
      pair[0].record2id !== pair[1].record1id ||
      pair[0].record1roleidname !== pair[1].record2roleidname ||
      pair[0].record2roleidname !== pair[1].record1roleidname
    ) {
      throw new TypeError("seed connection reciprocal pair is invalid");
    }
  }
  const metadataSets = normalized.metadata.entitySets;
  exactKeys(
    normalized.metadata,
    ["@odata.context", "namespace", "version", "entitySets"],
    "seed metadata",
  );
  if (
    normalized.metadata["@odata.context"] !==
      `${normalized.tenant.organizationUrl}/api/data/v9.2/$metadata` ||
    normalized.metadata.namespace !== "StaticDynamics365" ||
    normalized.metadata.version !== "9.2"
  ) {
    throw new TypeError("seed metadata header does not match the canonical tenant");
  }
  if (!Array.isArray(metadataSets) || metadataSets.length !== entityNames.length) {
    throw new TypeError("seed metadata entity sets do not match the runtime schema");
  }
  for (const entity of entityNames) {
    const metadataSet = metadataSets.find((item) => item.name === entity);
    const declared = new Set([
      ENTITY_DEFINITIONS[entity].id,
      ...Object.keys(ENTITY_DEFINITIONS[entity].fields),
    ]);
    if (
      !metadataSet ||
      metadataSet.key !== ENTITY_DEFINITIONS[entity].id ||
      !Array.isArray(metadataSet.properties) ||
      metadataSet.properties.length !== declared.size ||
      metadataSet.properties.some((property) => !declared.has(property.name))
    ) {
      throw new TypeError(`seed metadata for ${entity} does not match the runtime schema`);
    }
    exactKeys(
      metadataSet,
      ["name", "entityType", "key", "count", "properties"],
      `seed metadata set ${entity}`,
    );
    const singular = entity.endsWith("s") ? entity.slice(0, -1) : entity;
    if (
      metadataSet.entityType !== `StaticDynamics365.${singular}` ||
      metadataSet.count !== normalized.entities[entity].length
    ) {
      throw new TypeError(`seed metadata set ${entity} has invalid identity or count`);
    }
    for (const property of metadataSet.properties) {
      if (
        !property ||
        typeof property !== "object" ||
        Array.isArray(property) ||
        !["name,nullable,type", "name,nullable,options,type"].includes(
          Object.keys(property).sort(codeUnitCompare).join(","),
        )
      ) {
        throw new TypeError(`seed metadata property for ${entity} is malformed`);
      }
      const expected = expectedEdmProperty(entity, property.name);
      if (
        !expected ||
        property.type !== expected.type ||
        property.nullable !== expected.nullable
      ) {
        throw new TypeError(
          `seed metadata property ${entity}.${property.name} has the wrong type`,
        );
      }
      if (property.options !== undefined) {
        if (
          !Array.isArray(property.options) ||
          property.options.some(
            (option) =>
              !option ||
              typeof option !== "object" ||
              Object.keys(option).sort(codeUnitCompare).join(",") !== "label,value" ||
              !Number.isSafeInteger(option.value) ||
              typeof option.label !== "string" ||
              !option.label,
          )
        ) {
          throw new TypeError(
            `seed metadata options for ${entity}.${property.name} are malformed`,
          );
        }
      }
    }
  }
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
    this.idempotency = new Map();
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
    if (entity === "accounts") return record.name;
    if (entity === "contacts") return record.fullname;
    if (entity === "incidents") return record.title;
    return record.subject || id;
  }

  _identity(id = null) {
    const identities = this.initialSeed.identities || [];
    const selected = id
      ? identities.find((item) => item.systemuserid === id)
      : identities[0];
    if (!selected) throw new TypeError(`system user lookup ${id} does not resolve`);
    return selected;
  }

  _decorateLookups(entity, record) {
    if (entity === "accounts") {
      record.primarycontactidname = record.primarycontactid
        ? this._resolveName("contacts", record.primarycontactid)
        : null;
    } else if (entity === "contacts") {
      record.parentcustomeridname = this._resolveName("accounts", record.parentcustomerid);
    } else if (entity === "incidents") {
      record.customeridname = this._resolveName(record.customeridtype, record.customerid);
      record.primarycontactidname = this._resolveName("contacts", record.primarycontactid);
    } else if (entity === "tasks") {
      record.regardingobjectidtype = record.regardingobjectidtype || "incidents";
      record.regardingobjectidname = this._resolveName(
        record.regardingobjectidtype,
        record.regardingobjectid,
      );
    } else if (entity === "emails") {
      record.regardingobjectidtype = record.regardingobjectidtype || "incidents";
      record.regardingobjectidname = this._resolveName(
        record.regardingobjectidtype,
        record.regardingobjectid,
      );
      record.senderidname = this._resolvePartyName(record.senderidtype, record.senderid);
      record.recipientidname = this._resolvePartyName(record.recipientidtype, record.recipientid);
      record.fromname = record.senderidname;
      record.toname = record.recipientidname;
    } else if (entity === "connections") {
      record.record1idname = this._resolveName(record.record1type, record.record1id);
      record.record2idname = this._resolveName(record.record2type, record.record2id);
    }
    const owner = this._identity(record.ownerid);
    record.owneridname = owner.fullname;
    if (entity === "contacts") record.fullname = `${record.firstname} ${record.lastname}`.trim();
    const formatted = (field, value) => {
      record[`${field}@OData.Community.Display.V1.FormattedValue`] = value;
    };
    formatted("ownerid", record.owneridname);
    if (entity === "accounts" && record.primarycontactid) {
      formatted("primarycontactid", record.primarycontactidname);
    } else if (entity === "accounts") {
      delete record["primarycontactid@OData.Community.Display.V1.FormattedValue"];
    }
    if (entity === "contacts") formatted("parentcustomerid", record.parentcustomeridname);
    if (entity === "incidents") {
      formatted("customerid", record.customeridname);
      formatted("primarycontactid", record.primarycontactidname);
      formatted("prioritycode", CASE_PRIORITY_LABELS[record.prioritycode] || "Unknown");
      formatted("caseorigincode", CASE_ORIGIN_LABELS[record.caseorigincode] || "Unknown");
      formatted("casetypecode", CASE_TYPE_LABELS[record.casetypecode] || "Unknown");
      formatted("statecode", CASE_STATE_LABELS[record.statecode] || "Unknown");
      formatted("statuscode", CASE_STATUS_REASONS[record.statecode]?.[record.statuscode] || "Unknown");
    }
    if (entity === "tasks" || entity === "emails") {
      formatted("regardingobjectid", record.regardingobjectidname);
    }
    if (entity === "emails") {
      formatted("senderid", record.senderidname);
      formatted("recipientid", record.recipientidname);
    }
    if (entity === "connections") {
      formatted("record1id", record.record1idname);
      formatted("record2id", record.record2idname);
    }
    return record;
  }

  _resolvePartyName(type, id) {
    if (type === "systemusers") return this._identity(id).fullname;
    if (!["accounts", "contacts"].includes(type)) {
      throw new TypeError(`party type ${type} is not supported`);
    }
    return this._resolveName(type, id);
  }

  _defaults(entity, logicalId, payload = {}) {
    const owner = this._identity();
    const now = this.clock.now();
    const base = {
      ownerid: owner.systemuserid,
      owneridname: owner.fullname,
      createdon: now,
      modifiedon: now,
    };
    const sequence = String(Number.parseInt(sha256(logicalId).slice(0, 8), 16) % 100000).padStart(5, "0");
    if (entity === "accounts") {
      return {
        ...base,
        accountnumber: `AST-R${sequence}`,
        statecode: 0,
        statuscode: 1,
      };
    }
    if (entity === "contacts") {
      return { ...base, preferredcontactmethodcode: 2, statecode: 0, statuscode: 1 };
    }
    if (entity === "incidents") {
      return {
        ...base,
        ticketnumber: `CAS-R${sequence}`,
        prioritycode: 2,
        caseorigincode: 2,
        casetypecode: 3,
        statecode: 0,
        statuscode: 1,
        resolveby: new Date(this.clock.valueOf() + 6 * 86400000).toISOString(),
        firstresponsesenton: null,
        resolvedon: null,
      };
    }
    if (entity === "tasks") {
      return {
        ...base,
        regardingobjectidtype: "incidents",
        prioritycode: 2,
        percentcomplete: 0,
        actualend: null,
        statecode: 0,
        statuscode: 2,
      };
    }
    if (entity === "emails") {
      const rule = EMAIL_DIRECTION_RULES[String(payload.directioncode)] || EMAIL_DIRECTION_RULES.true;
      return {
        ...base,
        regardingobjectidtype: "incidents",
        scheduledstart: now,
        senton: now,
        statecode: rule.statecode,
        statuscode: rule.statuscode,
      };
    }
    if (entity === "connections") {
      return {
        ...base,
        connectionpairid: deterministicGuid(`${this.seedDigest}/${logicalId}/pair`),
        record1roleidname: null,
        record2roleidname: null,
        description: null,
        effectivestart: now,
        effectiveend: null,
        statecode: 0,
        statuscode: 1,
      };
    }
    throw new TypeError(`unsupported entity ${entity} for ${logicalId}`);
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

  _commitBatch(changes, logicalId) {
    let nextRevision = this.revisionCounter;
    const prepared = changes.map((change) => {
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
    if (!["accounts", "contacts"].includes(entity)) return [];
    const changes = [];
    const stage = (targetEntity, record, mutate) => {
      const next = clone(record);
      mutate(next);
      changes.push({
        entity: targetEntity,
        id: next[ENTITY_DEFINITIONS[targetEntity].id],
        record: next,
        kind: "cascade-update",
        before: record,
      });
    };
    const formatted = (record, field, value) => {
      record[`${field}@OData.Community.Display.V1.FormattedValue`] = value;
    };
    if (entity === "accounts") {
      const name = updated.name;
      for (const record of this._records("contacts")) {
        if (record.parentcustomerid === id) {
          stage("contacts", record, (next) => {
            next.parentcustomeridname = name;
            formatted(next, "parentcustomerid", name);
          });
        }
      }
      for (const record of this._records("incidents")) {
        if (record.customeridtype === "accounts" && record.customerid === id) {
          stage("incidents", record, (next) => {
            next.customeridname = name;
            formatted(next, "customerid", name);
          });
        }
      }
      for (const record of this._records("tasks")) {
        if (record.regardingobjectidtype === "accounts" && record.regardingobjectid === id) {
          stage("tasks", record, (next) => {
            next.regardingobjectidname = name;
            formatted(next, "regardingobjectid", name);
          });
        }
      }
      for (const record of this._records("emails")) {
        const regarding = record.regardingobjectidtype === "accounts" && record.regardingobjectid === id;
        const sender = record.senderidtype === "accounts" && record.senderid === id;
        const recipient = record.recipientidtype === "accounts" && record.recipientid === id;
        if (regarding || sender || recipient) {
          stage("emails", record, (next) => {
            if (regarding) {
              next.regardingobjectidname = name;
              formatted(next, "regardingobjectid", name);
            }
            if (sender) {
              next.senderidname = name;
              next.fromname = name;
              formatted(next, "senderid", name);
            }
            if (recipient) {
              next.recipientidname = name;
              next.toname = name;
              formatted(next, "recipientid", name);
            }
          });
        }
      }
    } else {
      const name = updated.fullname;
      for (const record of this._records("accounts")) {
        if (record.primarycontactid === id) {
          stage("accounts", record, (next) => {
            next.primarycontactidname = name;
            formatted(next, "primarycontactid", name);
          });
        }
      }
      for (const record of this._records("incidents")) {
        const primary = record.primarycontactid === id;
        const customer = record.customeridtype === "contacts" && record.customerid === id;
        if (primary || customer) {
          stage("incidents", record, (next) => {
            if (primary) {
              next.primarycontactidname = name;
              formatted(next, "primarycontactid", name);
            }
            if (customer) {
              next.customeridname = name;
              formatted(next, "customerid", name);
            }
          });
        }
      }
      for (const record of this._records("tasks")) {
        if (record.regardingobjectidtype === "contacts" && record.regardingobjectid === id) {
          stage("tasks", record, (next) => {
            next.regardingobjectidname = name;
            formatted(next, "regardingobjectid", name);
          });
        }
      }
      for (const record of this._records("emails")) {
        const regarding = record.regardingobjectidtype === "contacts" && record.regardingobjectid === id;
        const sender = record.senderidtype === "contacts" && record.senderid === id;
        const recipient = record.recipientidtype === "contacts" && record.recipientid === id;
        if (regarding || sender || recipient) {
          stage("emails", record, (next) => {
            if (regarding) {
              next.regardingobjectidname = name;
              formatted(next, "regardingobjectid", name);
            }
            if (sender) {
              next.senderidname = name;
              next.fromname = name;
              formatted(next, "senderid", name);
            }
            if (recipient) {
              next.recipientidname = name;
              next.toname = name;
              formatted(next, "recipientid", name);
            }
          });
        }
      }
      for (const record of this._records("connections")) {
        const first = record.record1id === id;
        const second = record.record2id === id;
        if (first || second) {
          stage("connections", record, (next) => {
            if (first) {
              next.record1idname = name;
              formatted(next, "record1id", name);
            }
            if (second) {
              next.record2idname = name;
              formatted(next, "record2id", name);
            }
          });
        }
      }
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
    const references = new Set();
    const add = (set, record, field, discriminator = null) => {
      if (
        record[field] === id &&
        (!discriminator || record[discriminator] === entity)
      ) {
        references.add(`${set}(${record[ENTITY_DEFINITIONS[set].id]})`);
      }
    };
    if (entity === "accounts") {
      for (const record of this._records("contacts")) add("contacts", record, "parentcustomerid");
      for (const record of this._records("incidents")) {
        add("incidents", record, "customerid", "customeridtype");
      }
      for (const record of this._records("tasks")) {
        add("tasks", record, "regardingobjectid", "regardingobjectidtype");
      }
      for (const record of this._records("emails")) {
        add("emails", record, "regardingobjectid", "regardingobjectidtype");
        add("emails", record, "senderid", "senderidtype");
        add("emails", record, "recipientid", "recipientidtype");
      }
    } else if (entity === "contacts") {
      for (const record of this._records("accounts")) add("accounts", record, "primarycontactid");
      for (const record of this._records("incidents")) {
        add("incidents", record, "customerid", "customeridtype");
        add("incidents", record, "primarycontactid");
      }
      for (const record of this._records("tasks")) {
        add("tasks", record, "regardingobjectid", "regardingobjectidtype");
      }
      for (const record of this._records("emails")) {
        add("emails", record, "regardingobjectid", "regardingobjectidtype");
        add("emails", record, "senderid", "senderidtype");
        add("emails", record, "recipientid", "recipientidtype");
      }
      for (const record of this._records("connections")) {
        add("connections", record, "record1id", "record1type");
        add("connections", record, "record2id", "record2type");
      }
    } else if (entity === "incidents") {
      for (const record of this._records("tasks")) {
        add("tasks", record, "regardingobjectid", "regardingobjectidtype");
      }
      for (const record of this._records("emails")) {
        add("emails", record, "regardingobjectid", "regardingobjectidtype");
      }
    }
    return [...references].sort(codeUnitCompare);
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
    const metadata = clone(this.initialSeed.metadata);
    for (const entitySet of metadata.entitySets) {
      entitySet.count = this.entities[entitySet.name].size;
    }
    return metadata;
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
        const record = { ...this._defaults(route.entity, creationToken, payload), ...payload };
        record[definition.id] = id;
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
      if (route.entity === "connections") {
        const reciprocal = this._records("connections").find(
          (record) =>
            record.connectionpairid === current.connectionpairid &&
            record.connectionid !== current.connectionid,
        );
        if (!reciprocal) {
          return errorResponse(409, "0x80040265", "The reciprocal connection is missing.");
        }
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
      } else {
        const references = this._deleteGuard(route.entity, route.id);
        if (references.length) {
          return errorResponse(
            409,
            "0x80040265",
            `The record is referenced by ${references.length} related record(s).`,
          );
        }
        this._commitBatch(
          [{
            entity: route.entity,
            id: route.id,
            record: null,
            kind: "delete",
            before: current,
          }],
          logicalId,
        );
      }
      return emptyResponse(204);
    }
    let payload;
    try {
      payload = validatePayload(route.entity, parseBody(init.body), "PATCH");
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
        (route.entity === "accounts" && merged.name !== current.name) ||
        (
          route.entity === "contacts" &&
          (merged.firstname !== current.firstname || merged.lastname !== current.lastname)
        )
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
    if (method === "GET") response = this._handleGet(route);
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
        for (const [field, type] of Object.entries(definition.fields)) {
          if (record[field] === undefined) {
            if (!type.endsWith("?")) throw new TypeError(`${entity}.${field} is missing`);
            continue;
          }
          validateFieldType(field, type, record[field]);
          const allowed = definition.discriminators[field];
          if (allowed && !allowed.includes(record[field])) {
            throw new TypeError(`${entity}.${field} has an invalid discriminator`);
          }
          const range = definition.ranges[field];
          if (range && (record[field] < range[0] || record[field] > range[1])) {
            throw new TypeError(`${entity}.${field} is outside its declared range`);
          }
        }
        validateRequiredFields(entity, record);
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
      schemaVersion: 2,
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
    ![1, 2].includes(run.schemaVersion) ||
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
