import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreviewFiles } from "./preview-files.mjs";
import {
  detectLocalDevUrl,
  previewRequestAllowed,
} from "../renderer/shared/preview/index.mjs";

async function site() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "prevf-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "prevf-out-")));
  writeFileSync(join(root, "index.html"), "<script src=app.js></script>");
  writeFileSync(join(root, "app.js"), "1");
  writeFileSync(join(root, "n.md"), "# <b>&\"'");
  writeFileSync(join(root, "i.svg"), "<svg/>");
  writeFileSync(join(root, "secret.env"), "x");
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "c.json"), "{}");
  writeFileSync(join(outside, "o.html"), "outside");
  symlinkSync(join(outside, "o.html"), join(root, "link.html"));
  symlinkSync(outside, join(root, "dir"));
  const files = createPreviewFiles({
    resolveWorkspace: (id) => (id === "w" ? root : undefined),
  });
  const { token, origin, entry } = await files.register("w", "index.html");
  return { files, token, origin, entry, root };
}

test("served files: content types, CSP, markdown escaped", async () => {
  const { files, origin, entry } = await site();
  assert.match(entry, /^omoc-preview:\/\/[0-9a-f]{32}\/index\.html$/);
  const html = await files.serve(entry);
  assert.equal(html.status, 200);
  assert.match(html.headers["content-type"], /text\/html/);
  assert.match(html.headers["content-security-policy"], /script-src 'self'/);
  assert.match(html.headers["content-security-policy"], /object-src 'none'/);
  assert.equal(html.headers["x-content-type-options"], "nosniff");
  const js = await files.serve(`${origin}app.js?v=1`);
  assert.match(js.headers["content-type"], /javascript/);
  const md = await files.serve(`${origin}n.md`);
  assert.match(
    String(md.body),
    /<pre[^>]*>#\s*&#60;b&#62;&#38;&#34;&#39;<\/pre>/,
  );
  assert.doesNotMatch(String(md.body), /<b>/);
  const svg = await files.serve(`${origin}i.svg`);
  assert.equal(svg.headers["content-type"], "image/svg+xml");
  assert.match(svg.headers["content-security-policy"], /default-src 'none'/);
});

test("served files: traversal, encodings, symlinks, absolute, types", async () => {
  const { files, origin, token } = await site();
  const deny = async (path, status) =>
    assert.equal((await files.serve(origin + path)).status, status, path);
  await deny("../../etc/passwd", 403); // URL parser collapses to etc/passwd: no allowed type
  await deny("%2e%2e/%2e%2e/etc/passwd", 403);
  await deny("%2e%2e/%2e%2e/etc/hosts.html", 404); // collapsed into the root
  await deny("%252e%252e/x.html", 404); // decoded once: literal "%2e%2e" name, not ..
  await deny("sub%2f..%2f..%2fx.html", 403); // encoded slashes decode into ..
  await deny("%2e%2e%5cindex.html", 403); // backslash
  await deny("link.html", 403); // symlink file escaping the root
  await deny("dir/o.html", 403); // symlinked directory
  await deny("secret.env", 403); // type not allowed
  await deny(".git/c.json", 403);
  await deny("missing.html", 404);
  await deny("%00.html", 403);
  assert.equal(
    (await files.serve(`omoc-preview://${"0".repeat(32)}/index.html`)).status,
    404,
  );
  assert.equal(
    (await files.serve(`omoc-preview://${token}.evil/index.html`)).status,
    404,
  );
  assert.equal((await files.serve("https://example.com/")).status, 404);
  assert.equal((await files.serve("not a url")).status, 400);
  // revoked tokens stop serving
  files.revoke(token);
  await deny("index.html", 404);
});

test("register refuses before issuing a token", async () => {
  const { files } = await site();
  for (const [path, code] of [
    ["/etc/passwd", "PATH_DENIED"],
    ["../x.html", "PATH_DENIED"],
    ["a/../../x.html", "PATH_DENIED"],
    ["link.html", "PATH_DENIED"],
    ["secret.env", "UNSUPPORTED_TYPE"],
    ["nope.html", "NOT_FOUND"],
  ])
    await assert.rejects(
      files.register("w", path),
      { previewCode: code },
      path,
    );
  await assert.rejects(files.register("zz", "index.html"), {
    previewCode: "NOT_FOUND",
  });
});

test("network allowlist for preview sessions", () => {
  const ok = [
    ["http://localhost:3000/a", "url"],
    ["http://127.0.0.1/", "url"],
    ["http://[::1]:5173/x", "file"],
    ["ws://localhost:5173/", "url"],
    ["data:image/png;base64,AA", "file"],
    ["omoc-preview://abc/x.html", "file"],
    ["chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html", "file"],
  ];
  const no = [
    ["omoc-preview://abc/x.html", "url"],
    ["https://localhost:3000/", "url"],
    ["http://localhost@evil.com/", "url"],
    ["http://user:pw@localhost/", "url"],
    ["http://localhost.evil.com/", "url"],
    ["http://evil.com/", "file"],
    ["https://evil.com/", "file"],
    ["wss://localhost/", "url"],
    ["ftp://localhost/", "url"],
    ["file:///etc/passwd", "file"],
    ["chrome://gpu", "url"],
    ["http://0.0.0.0:3000/", "url"],
    ["chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html", "url"],
    ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/x.js", "file"],
    ["nonsense", "url"],
  ];
  for (const [u, m] of ok) assert.equal(previewRequestAllowed(u, m), true, u);
  for (const [u, m] of no) assert.equal(previewRequestAllowed(u, m), false, u);
});

test("dev-server URL detection", () => {
  assert.equal(
    detectLocalDevUrl("  ➜  Local:   http://localhost:5173/\n"),
    "http://localhost:5173/",
  );
  assert.equal(
    detectLocalDevUrl("ready on http://127.0.0.1:3000"),
    "http://127.0.0.1:3000/",
  );
  assert.equal(
    detectLocalDevUrl("at http://[::1]:8080/x"),
    "http://[::1]:8080/",
  );
  assert.equal(
    detectLocalDevUrl("http://localhost:3000 then http://localhost:3001/"),
    "http://localhost:3001/",
  );
  assert.equal(
    detectLocalDevUrl("https://localhost:8443/"),
    "http://localhost:8443/",
  );
  for (const t of [
    "http://localhost/",
    "http://localhost:99999",
    "http://localhost:0/",
    "http://evil.com:3000/",
    "http://localhost.evil.com:3000/",
    "http://x@localhost:3000/",
    "localhost:3000",
    "",
    42,
  ])
    assert.equal(detectLocalDevUrl(t), undefined, String(t));
});
