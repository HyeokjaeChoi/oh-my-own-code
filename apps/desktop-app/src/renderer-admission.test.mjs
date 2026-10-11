import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptsNoIpcArguments,
  admitsRendererRequest,
} from "./renderer-admission.mjs";

test("admits only the allowed top-level frame of the main web contents", () => {
  const mainFrame = { url: "file:///app/renderer/index.html" };
  const subframe = { url: mainFrame.url };
  const webContents = { mainFrame };
  const allowed = (url) => url === mainFrame.url;

  assert.equal(
    admitsRendererRequest(
      { sender: webContents, senderFrame: mainFrame },
      webContents,
      allowed,
    ),
    true,
  );
  assert.equal(
    admitsRendererRequest(
      { sender: webContents, senderFrame: subframe },
      webContents,
      allowed,
    ),
    false,
  );
  assert.equal(
    admitsRendererRequest(
      { sender: {}, senderFrame: mainFrame },
      webContents,
      allowed,
    ),
    false,
  );
  assert.equal(
    admitsRendererRequest(
      { sender: webContents, senderFrame: { url: "https://example.com" } },
      webContents,
      allowed,
    ),
    false,
  );
});

test("accepts no arguments and rejects malformed IPC payloads", () => {
  assert.equal(acceptsNoIpcArguments([]), true);
  assert.equal(acceptsNoIpcArguments([{}]), false);
});
