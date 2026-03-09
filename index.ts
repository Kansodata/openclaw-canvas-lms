import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createCanvasLmsTool } from "./src/canvas-lms-tool.ts";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createCanvasLmsTool(api) as unknown as AnyAgentTool, { optional: true });
}
