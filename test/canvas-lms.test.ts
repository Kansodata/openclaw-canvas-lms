import test from "node:test";
import assert from "node:assert/strict";

import register from "../index.ts";
import { __test } from "../src/canvas-lms-tool.ts";

test("plugin registers the canvas-lms tool with current imports", () => {
  const registrations: Array<{ tool: unknown; options: unknown }> = [];
  const api = {
    pluginConfig: {},
    registerTool(tool: unknown, options: unknown) {
      registrations.push({ tool, options });
    },
  };

  register(api);

  assert.equal(registrations.length, 1);
  const [entry] = registrations;
  assert.equal(
    typeof entry.tool === "object" && entry.tool !== null && "name" in entry.tool
      ? entry.tool.name
      : undefined,
    "canvas-lms",
  );
  assert.deepEqual(entry.options, { optional: true });
});

test("redactSensitive redacts sensitive fields in regular JSON", () => {
  const raw = JSON.stringify({
    access_token: "abc",
    refresh_token: "def",
    client_secret: "ghi",
    authorization: "Bearer xyz",
  });

  const redacted = __test.redactSensitive(raw);

  assert.match(redacted, /"access_token":"\[redacted\]"/);
  assert.match(redacted, /"refresh_token":"\[redacted\]"/);
  assert.match(redacted, /"client_secret":"\[redacted\]"/);
  assert.match(redacted, /"authorization":"\[redacted\]/);
  assert.doesNotMatch(redacted, /"access_token":"abc"/);
  assert.doesNotMatch(redacted, /"refresh_token":"def"/);
  assert.doesNotMatch(redacted, /"client_secret":"ghi"/);
  assert.doesNotMatch(redacted, /"authorization":"Bearer xyz"/);
});
