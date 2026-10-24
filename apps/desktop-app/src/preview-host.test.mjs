import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreviewHost } from "./host/preview-host.mjs";
import { bindPreviewIpc } from "./host/preview-ipc.mjs";
import {
  parseLocalUrl,
  parseExternalUrl,
  navigationDecision,
  validatePreviewRequest,
} from "./renderer/shared/preview/index.mjs";

test("local URL allow/deny", () => {
  for (const ok of [
    "http://localhost:3000/",
    "http://127.0.0.1:5173/a?b=1",
    "http://[::1]:8080/",
    "http://localhost/",
  ])
    assert.ok(parseLocalUrl(ok), ok);
  for (const bad of [
    "https://localhost:3000/",
    "http://localhost.evil.com:3000/",
    "http://localhost@evil.com/",
    "http://localhost:3000@evil.com/",
    "http://user:pw@localhost:3000/",
    "http://evil.com/",
    "http://0.0.0.0:3000/",
    "http://[::]:3000/",
    "http://[::ffff:7f00:1]:3000/",
    "http://localhost.:3000/",
    "http://127.0.0.1.evil.com/",
    "http://192.168.0.1:3000/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://",
    "",
    42,
    "http://localhost/" + "a".repeat(3000),
  ])
    assert.equal(parseLocalUrl(bad), undefined, String(bad).slice(0, 40));
});

test("external URL and navigation decision", () => {
  assert.ok(parseExternalUrl("https://example.com/x"));
  assert.equal(parseExternalUrl("javascript:alert(1)"), undefined);
  assert.equal(parseExternalUrl("https://u:p@example.com/"), undefined);
  assert.equal(parseExternalUrl("file:///etc/passwd"), undefined);
  assert.equal(navigationDecision("url", "http://localhost:1/"), "allow");
  assert.equal(navigationDecision("url", "https://example.com/"), "external");
  assert.equal(navigationDecision("url", "file:///etc/passwd"), "deny");
  const o = "omoc-preview://abc/";
  assert.equal(navigationDecision("file", `${o}a.html`, o), "allow");
  assert.equal(navigationDecision("file", "omoc-preview://abcd/", o), "deny");
  assert.equal(navigationDecision("file", `${o}a.html`), "deny"); // no origin
  assert.equal(
    navigationDecision("file", "https://example.com/", o),
    "external",
  );
  assert.equal(
    navigationDecision("file", "http://localhost:1/", o),
    "external",
  );
  assert.equal(navigationDecision("url", `${o}a.html`, o), "deny");
});

test("request validation", () => {
  const good = [
    { type: "preview.open", workspaceId: "w1", url: "x" },
    { type: "preview.openFile", workspaceId: "w1", path: "a/b.md" },
    { type: "preview.bounds", x: 0, y: 1, width: 2, height: 3 },
    { type: "preview.nav", action: "back" },
    { type: "preview.state" },
    { type: "preview.openExternal", url: "https://a.b" },
    { type: "preview.close" },
  ];
  for (const g of good) assert.ok(validatePreviewRequest(g), g.type);
  for (const bad of [
    null,
    [],
    "preview.close",
    { type: "nope" },
    { type: "preview.close", extra: 1 },
    { type: "preview.open", workspaceId: "w1" },
    { type: "preview.open", workspaceId: "w1", url: 1 },
    { type: "preview.bounds", x: -1, y: 0, width: 1, height: 1 },
    { type: "preview.bounds", x: 0.5, y: 0, width: 1, height: 1 },
    { type: "preview.bounds", x: 0, y: 0, width: 1e9, height: 1 },
    { type: "preview.nav", action: "stop" },
    { type: "preview.openFile", workspaceId: "w 1", path: "a" },
    { type: "preview.openFile", workspaceId: "w1", path: "" },
    { type: "preview.openFile", workspaceId: "w1", path: "a\0b" },
    Object.assign(Object.create({ type: "preview.close" }), {}),
  ])
    assert.equal(validatePreviewRequest(bad), undefined, JSON.stringify(bad));
});

function fakeView() {
  const wc = new EventEmitter();
  Object.assign(wc, {
    loads: [],
    url: "",
    loading: false,
    back: false,
    fwd: false,
    calls: [],
    loadURL(u) {
      wc.loads.push(u);
      wc.url = u;
      return Promise.resolve();
    },
    getURL: () => wc.url,
    isLoading: () => wc.loading,
    goBack: () => wc.calls.push("back"),
    goForward: () => wc.calls.push("forward"),
    reload: () => wc.calls.push("reload"),
    navigationHistory: { canGoBack: () => wc.back, canGoForward: () => wc.fwd },
    setWindowOpenHandler(fn) {
      wc.openHandler = fn;
    },
  });
  return {
    webContents: wc,
    bounds: undefined,
    destroyed: 0,
    setBounds(b) {
      this.bounds = b;
    },
    destroy() {
      this.destroyed++;
    },
  };
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "prev-")));
  const views = [];
  const opened = [];
  const host = createPreviewHost({
    createView: (opts) => {
      const v = fakeView();
      v.opts = opts;
      views.push(v);
      return v;
    },
    resolveWorkspace: (id) => (id === "w1" ? root : undefined),
    openExternal: (u) => opened.push(u),
  });
  return { root, views, opened, host };
}
const nav = (url) => ({
  url,
  prevented: false,
  preventDefault() {
    this.prevented = true;
  },
});

test("open allows only local URLs and guards navigation", async () => {
  const { host, views, opened } = fixture();
  await assert.rejects(host.open("1", "w1", "https://example.com/"), {
    previewCode: "URL_DENIED",
  });
  assert.equal(views.length, 0);
  const s = await host.open("1", "w1", "http://localhost:3000/");
  assert.equal(s.open, true);
  assert.equal(s.url, "http://localhost:3000/");
  assert.equal(views[0].opts.mode, "url");
  const wc = views[0].webContents;
  for (const ev of ["will-frame-navigate", "will-redirect"]) {
    const ok = nav("http://127.0.0.1:9/");
    wc.emit(ev, ok);
    assert.equal(ok.prevented, false);
    const bad = nav("file:///etc/passwd");
    wc.emit(ev, bad);
    assert.equal(bad.prevented, true);
  }
  const ext = nav("https://evil.example/");
  wc.emit("will-frame-navigate", ext);
  assert.equal(ext.prevented, true);
  assert.equal(host.state("1").externalRequest, "https://evil.example/");
  assert.deepEqual(wc.openHandler({ url: "https://x.example/" }), {
    action: "deny",
  });
  assert.equal(host.state("1").externalRequest, "https://x.example/");
  assert.deepEqual(wc.openHandler({ url: "javascript:1" }), { action: "deny" });
  // external open is gated on http(s)/local only and never opens file:
  await host.openExternal("1", "https://x.example/");
  assert.deepEqual(opened, ["https://x.example/"]);
  assert.throws(() => host.openExternal("1", "file:///etc/passwd"), {
    previewCode: "URL_DENIED",
  });
  // only the page's current URL or a link it asked for; never an arbitrary renderer-supplied URL
  assert.throws(() => host.openExternal("1", "https://other.example/"), {
    previewCode: "URL_DENIED",
  });
  assert.throws(() => host.openExternal("9", "https://x.example/"), {
    previewCode: "URL_DENIED",
  });
  await host.openExternal("1", "http://localhost:3000/");
});

test("load failure surfaces as error state, abort ignored", async () => {
  const { host, views } = fixture();
  await host.open("1", "w1", "http://localhost:3000/");
  const wc = views[0].webContents;
  wc.emit(
    "did-fail-load",
    {},
    -3,
    "ERR_ABORTED",
    "http://localhost:3000/",
    true,
  );
  assert.equal(host.state("1").error, null);
  wc.emit(
    "did-fail-load",
    {},
    -102,
    "ERR_CONNECTION_REFUSED",
    "http://localhost:3000/",
    true,
  );
  assert.equal(host.state("1").error, "ERR_CONNECTION_REFUSED");
  wc.emit("did-start-loading");
  assert.equal(host.state("1").error, null);
});

test("nav, bounds, owner isolation, lifecycle", async () => {
  const { host, views } = fixture();
  assert.throws(() => host.nav("1", "reload"), { previewCode: "NOT_OPEN" });
  await host.open("1", "w1", "http://localhost:3000/");
  await host.open("2", "w1", "http://localhost:3001/");
  const wc = views[0].webContents;
  wc.back = true;
  host.nav("1", "back");
  host.nav("1", "forward"); // cannot go forward
  host.nav("1", "reload");
  assert.deepEqual(wc.calls, ["back", "reload"]);
  host.setBounds("1", { x: 1, y: 2, width: 3, height: 4 });
  assert.deepEqual(views[0].bounds, { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(views[1].bounds, undefined);
  host.closeOwner("1");
  assert.equal(views[0].destroyed, 1);
  assert.equal(host.state("1").open, false);
  host.closeOwner("1");
  assert.equal(views[0].destroyed, 1);
  host.closeAll();
  assert.equal(views[1].destroyed, 1);
  assert.equal(host.state("2").open, false);
  assert.equal(host.close("2").open, false);
});

test("openFile: every kind opens a fresh token-origin file view; path safety", async () => {
  const { host, views, root } = fixture();
  writeFileSync(join(root, "a.md"), "# hi <script>");
  writeFileSync(join(root, "p.png"), Buffer.from([1, 2, 3]));
  writeFileSync(join(root, "s.html"), "<h1>x</h1>");
  writeFileSync(join(root, "d.pdf"), "%PDF-1.4");
  writeFileSync(join(root, "x.txt"), "no");
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "prev-out-")));
  writeFileSync(join(outside, "o.html"), "secret");
  symlinkSync(join(outside, "o.html"), join(root, "link.html"));
  const html = await host.openFile("1", "w1", "s.html");
  assert.equal(html.kind, "html");
  assert.equal(views[0].opts.mode, "file");
  const first = views[0].webContents.loads[0];
  assert.match(first, /^omoc-preview:\/\/[0-9a-f]{32}\/s\.html$/);
  // the renderer only sees the relative path, never the token origin
  assert.equal(html.state.url, "");
  assert.equal(html.state.file, "s.html");
  // file view may follow links inside its own origin only; http(s) becomes an external request
  const origin = first.slice(0, first.indexOf("/s.html") + 1);
  const wc = views[0].webContents;
  const inside = nav(`${origin}other.html`);
  wc.emit("will-frame-navigate", inside);
  assert.equal(inside.prevented, false);
  for (const url of [
    "omoc-preview://ffffffffffffffffffffffffffffffff/s.html",
    "file:///etc/passwd",
    "data:text/html,x",
    "javascript:alert(1)",
  ]) {
    const e = nav(url);
    wc.emit("will-redirect", e);
    assert.equal(e.prevented, true, url);
  }
  const ext = nav("https://evil.example/");
  wc.emit("will-frame-navigate", ext);
  assert.equal(ext.prevented, true);
  assert.equal(host.state("1").externalRequest, "https://evil.example/");
  // each open gets a new view and a new origin; the old token stops serving
  const served = await host.serve(`${origin}s.html`);
  assert.equal(served.status, 200);
  for (const [name, kind] of [
    ["a.md", "markdown"],
    ["p.png", "image"],
    ["d.pdf", "pdf"],
  ])
    assert.equal((await host.openFile("1", "w1", name)).kind, kind);
  assert.equal(views.length, 4);
  assert.equal(views[0].destroyed, 1);
  assert.equal((await host.serve(`${origin}s.html`)).status, 404);
  for (const [path, code] of [
    ["../x.html", "PATH_DENIED"],
    ["link.html", "PATH_DENIED"],
    [join(outside, "o.html"), "PATH_DENIED"],
    ["x.txt", "UNSUPPORTED_TYPE"],
    ["missing.md", "NOT_FOUND"],
  ])
    await assert.rejects(host.openFile("1", "w1", path), { previewCode: code });
  await assert.rejects(host.openFile("1", "nope", "a.md"), {
    previewCode: "NOT_FOUND",
  });
  assert.equal(views.length, 4); // refusals never create a view
});

test("IPC admits, validates and maps errors", async () => {
  const { host, views } = fixture();
  let handler;
  const ipcMain = { handle: (_c, fn) => (handler = fn) };
  let admitted = true;
  bindPreviewIpc({ ipcMain, admit: () => admitted, host });
  const ev = { sender: { id: 7 } };
  assert.deepEqual(await handler(ev, { type: "preview.close", x: 1 }), {
    ok: false,
    code: "INVALID_REQUEST",
  });
  assert.deepEqual(await handler(ev), { ok: false, code: "INVALID_REQUEST" });
  assert.deepEqual(await handler(ev, { type: "preview.close" }, 2), {
    ok: false,
    code: "INVALID_REQUEST",
  });
  assert.deepEqual(
    await handler(ev, {
      type: "preview.open",
      workspaceId: "w1",
      url: "https://example.com",
    }),
    { ok: false, code: "URL_DENIED" },
  );
  const r = await handler(ev, {
    type: "preview.open",
    workspaceId: "w1",
    url: "http://localhost:3000/",
  });
  assert.equal(r.ok, true);
  assert.equal(views.length, 1);
  assert.deepEqual(
    await handler(ev, {
      type: "preview.bounds",
      x: 1,
      y: 1,
      width: 5,
      height: 5,
    }),
    { ok: true, value: null },
  );
  assert.equal(views[0].bounds.width, 5);
  assert.deepEqual(
    await handler(ev, { type: "preview.openExternal", url: "file:///x" }),
    { ok: false, code: "URL_DENIED" },
  );
  admitted = false;
  assert.deepEqual(await handler(ev, { type: "preview.state" }), {
    ok: false,
    code: "INVALID_REQUEST",
  });
  admitted = true;
  assert.equal((await handler(ev, { type: "preview.close" })).ok, true);
  assert.equal(views[0].destroyed, 1);
});
