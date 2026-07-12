import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("browser shell has strict CSP and only same-origin relative resources", () => {
  const html = read("site/index.html");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "worker-src 'none'",
  ]) {
    assert.ok(html.includes(directive), directive);
  }
  assert.doesNotMatch(html, /frame-ancestors/i);
  assert.match(html, /src="\.\/app\.mjs"/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.doesNotMatch(html, /<(script|link)[^>]+(?:src|href)="https?:/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.doesNotMatch(html, /\sstyle=/i);
});

test("Pages deployment publishes the site artifact root without application secrets", () => {
  const workflow = read(".github/workflows/pages.yml");
  assert.match(workflow, /^\s*pages:\s*write\s*$/m);
  assert.match(workflow, /uses:\s*actions\/configure-pages@v5/);
  assert.doesNotMatch(workflow, /PAGES_TOKEN|secrets\./);
  assert.match(
    workflow,
    /uses:\s*actions\/upload-pages-artifact@v3\s+with:\s+path:\s*site(?:\s|$)/,
  );
  const configure = workflow.indexOf("actions/configure-pages@v5");
  const upload = workflow.indexOf("actions/upload-pages-artifact@v3");
  const deploy = workflow.indexOf("actions/deploy-pages@v4");
  assert.ok(configure >= 0 && configure < upload && upload < deploy);
  assert.equal(fs.existsSync(path.join(root, "site", ".nojekyll")), true);
  const readme = read("README.md");
  assert.match(readme, /administrator enables[\s\S]*GitHub Pages[\s\S]*GitHub Actions/i);
  assert.match(readme, /require no application\s+secret/i);
});

test("security documentation states the GitHub Pages anti-framing boundary", () => {
  const documentation = [read("README.md"), read("SECURITY.md")];
  for (const source of documentation) {
    assert.match(source, /frame-ancestors/);
    assert.match(source, /HTTP[\s\S]{0,100}response\s+header/i);
    assert.match(source, /GitHub Pages/i);
  }
});

test("browser sources avoid unsafe DOM sinks and native dialogs", () => {
  const source = [read("site/app.mjs"), read("site/app-helpers.mjs")].join("\n");
  const forbidden = [
    "inner" + "HTML",
    "outer" + "HTML",
    "insertAdjacent" + "HTML",
    "document" + ".write",
    "eval" + "(",
    "new " + "Function",
    "alert" + "(",
    "confirm" + "(",
    ".style" + ".",
    ".on" + "click =",
  ];
  for (const token of forbidden) assert.equal(source.includes(token), false, token);
  assert.ok(source.includes("textContent"));
  assert.ok(source.includes("noopener noreferrer"));
  assert.ok(source.includes("showModal"));
});

test("sitemap and visible product identity are standalone and complete", () => {
  const html = read("site/index.html");
  assert.ok(html.includes("Static Dynamics 365"));
  assert.ok(html.includes("Customer Service Hub"));
  const expected = [
    "Dashboards",
    "Activities",
    "Accounts",
    "Contacts",
    "Cases",
    "Queues",
    "Knowledge Articles",
    "Knowledge Search",
    "Simulation settings",
    "API &amp; simulation",
  ];
  let cursor = 0;
  for (const label of expected) {
    const index = html.indexOf(label, cursor);
    assert.ok(index > cursor, label);
    cursor = index;
  }
});

test("application source wires grids, forms, dashboards, relationships, and lifecycle actions", () => {
  const source = read("site/app.mjs");
  for (const feature of [
    "renderDashboard",
    "renderGrid",
    "renderRecordForm",
    "renderRelatedPanel",
    "relatedConnectionsForContact",
    "Mark Complete",
    "Resolve",
    "Reopen",
    "outcome.status === 412",
    "safeUiRequest",
    "replaceCreatedRecordHistory",
    "popstate",
    "aria-selected",
    "PAGE_SIZE",
  ]) {
    assert.ok(source.toLowerCase().includes(feature.toLowerCase()), feature);
  }
});

test("record lifecycle UI uses the tested confirmation-before-save coordinator", () => {
  const source = read("site/app.mjs");
  for (const [startName, endName] of [
    ["async function transitionCurrentRecord", "async function deleteCurrentRecord"],
    ["async function deleteCurrentRecord", "async function renderRecordRoute"],
  ]) {
    const start = source.indexOf(startName);
    const end = source.indexOf(endName, start + startName.length);
    const body = source.slice(start, end);
    assert.ok(body.includes("runConfirmedLifecycleAction"));
    const confirmation = body.indexOf("requestConfirmation:");
    const save = body.indexOf("save:");
    const transition = body.indexOf("transition:");
    assert.ok(confirmation >= 0 && confirmation < save && save < transition);
    assert.ok(body.includes('saved["@odata.etag"]'));
  }
});

test("bulk deletion and the skip link use atomic and route-preserving paths", () => {
  const source = read("site/app.mjs");
  const deleteStart = source.indexOf("async function deleteSelected");
  const deleteEnd = source.indexOf("function setGridCommands", deleteStart);
  const deleteSource = source.slice(deleteStart, deleteEnd);
  assert.ok(deleteSource.includes("safeUiDeleteMany"));
  assert.equal(deleteSource.includes("safeUiBatch"), false);

  const skipStart = source.indexOf("shouldInterceptSkipLink({");
  const skipEnd = source.indexOf("shouldInterceptSpaNavigation({", skipStart);
  const skipSource = source.slice(skipStart, skipEnd);
  assert.ok(skipSource.includes("event.preventDefault()"));
  assert.ok(skipSource.includes("dom.mainContent.focus()"));
  assert.ok(skipSource.includes("return;"));
  assert.equal(skipSource.includes("requestNavigation"), false);
  assert.equal(skipSource.includes("window.history"), false);
  assert.equal(skipSource.includes("window.location"), false);
});

test("project-subpath asset and module references are relative", () => {
  const html = read("site/index.html");
  const app = read("site/app.mjs");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = match[1];
    if (value.startsWith("#")) continue;
    assert.ok(value.startsWith("./"), value);
  }
  for (const match of app.matchAll(/from\s+"([^"]+)"/g)) {
    assert.ok(match[1].startsWith("./"), match[1]);
  }
  assert.ok(app.includes('new URL("./data/seed.json", import.meta.url)'));
});

test("tracked and untracked project files contain no source-specific leakage", () => {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.startsWith(".git/"));
  const terms = [
    "ra" + "pp" + "terbook",
    "ra" + "pp" + "-static-apis",
    "zi" + "on",
    "ko" + "dy" + " wildfeuer",
    "new" + "_",
    "state" + "_io",
    "ra" + "pp" + "terbook.ai",
    "service" + "Worker",
  ];
  const allowedDemo = "https://" + "ko" + "dy" + "-w.github.io/static-dynamics-365/";
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.statSync(full).isFile()) continue;
    const source = fs.readFileSync(full, "utf8").toLowerCase();
    for (const term of terms) {
      assert.equal(source.includes(term.toLowerCase()), false, `${file}: ${term}`);
    }
    const ownerToken = ("ko" + "dy" + "-w").toLowerCase();
    if (source.includes(ownerToken)) {
      assert.equal(file, "README.md");
      assert.equal(source.split(ownerToken).length - 1, 1);
      assert.ok(source.includes(allowedDemo));
    }
  }
});

test("no offline worker or third-party runtime endpoint is present", () => {
  const files = fs.readdirSync(path.join(root, "site"));
  assert.equal(files.some((name) => name.toLowerCase().includes("sw.js")), false);
  const app = read("site/app.mjs");
  assert.equal(app.includes("navigator." + "service" + "Worker"), false);
  assert.equal(app.includes("fetch(\"http"), false);
});
