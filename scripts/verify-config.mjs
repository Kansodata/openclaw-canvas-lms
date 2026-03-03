import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8");
const parsed = JSON.parse(raw);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(parsed && typeof parsed === "object", "openclaw.plugin.json must be a JSON object");
assert(typeof parsed.id === "string" && parsed.id.trim().length > 0, "plugin id is required");
assert(typeof parsed.name === "string" && parsed.name.trim().length > 0, "plugin name is required");
assert(parsed.configSchema && typeof parsed.configSchema === "object", "configSchema is required");
assert(parsed.configSchema.type === "object", "configSchema.type must be 'object'");

const props = parsed.configSchema.properties ?? {};
const hasBaseUrl = Object.prototype.hasOwnProperty.call(props, "baseUrl");
const hasTokenOrOauth =
  Object.prototype.hasOwnProperty.call(props, "token") ||
  Object.prototype.hasOwnProperty.call(props, "oauth");

assert(hasBaseUrl, "configSchema.properties.baseUrl must be declared");
assert(hasTokenOrOauth, "configSchema should declare token and/or oauth auth fields");

console.log("verify-config: ok");
