export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_PAGES = 5;

export type CanvasLmsPluginConfig = {
  baseUrl?: string;
  token?: string;
  oauth?: {
    tokenUrl?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    accessToken?: string;
    expiresAt?: string | number;
  };
  defaultPerPage?: number;
  maxPages?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  allowInlineToken?: boolean;
  allowInsecureHttp?: boolean;
  allowBaseUrlOverride?: boolean;
  digestPublishSessionKeys?: string[];
};

export function normalizeBaseUrl(
  input: string,
  options?: { allowInsecureHttp?: boolean },
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Canvas baseUrl is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Canvas baseUrl: ${trimmed}`);
  }
  if (parsed.protocol !== "https:") {
    if (parsed.protocol !== "http:") {
      throw new Error("Canvas baseUrl must use https://");
    }
    if (options?.allowInsecureHttp !== true) {
      throw new Error("Canvas baseUrl must use https:// (http:// is disabled by default)");
    }
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

export function extractNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  const segments = linkHeader.split(",");
  for (const segment of segments) {
    const match = segment.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/i);
    if ((match?.[2] ?? "").toLowerCase() === "next") {
      return match?.[1] ?? null;
    }
  }
  return null;
}

export function readString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function readConfigString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function redactSensitive(text: string): string {
  return text
    .replace(/(["\\]?access_token["\\]?\s*:\s*["\\]?)[^"\\\s,}]+(["\\]?)/gi, "$1[redacted]$2")
    .replace(/(["\\]?refresh_token["\\]?\s*:\s*["\\]?)[^"\\\s,}]+(["\\]?)/gi, "$1[redacted]$2")
    .replace(/(["\\]?client_secret["\\]?\s*:\s*["\\]?)[^"\\\s,}]+(["\\]?)/gi, "$1[redacted]$2")
    .replace(/(["\\]?authorization["\\]?\s*:\s*["\\]?)[^"\\\s,}]+(["\\]?)/gi, "$1[redacted]$2");
}

export function resolveBaseUrl(params: {
  args: Record<string, unknown>;
  pluginConfig: CanvasLmsPluginConfig;
  allowInsecureHttp: boolean;
}): string {
  const configured =
    readConfigString(params.pluginConfig.baseUrl) ??
    readConfigString(process.env.CANVAS_LMS_BASE_URL) ??
    "";
  const requested = readString(params.args, "baseUrl");
  if (!configured && !requested) {
    throw new Error("Canvas baseUrl must be configured in plugin config or CANVAS_LMS_BASE_URL.");
  }
  if (requested && params.pluginConfig.allowBaseUrlOverride !== true) {
    throw new Error(
      "baseUrl override is disabled. Configure baseUrl in plugin config or set allowBaseUrlOverride=true.",
    );
  }
  const selected =
    requested && params.pluginConfig.allowBaseUrlOverride === true ? requested : configured;
  return normalizeBaseUrl(selected ?? "", { allowInsecureHttp: params.allowInsecureHttp });
}

export function readPerPage(params: Record<string, unknown>, configured?: number): number {
  const local = typeof params.perPage === "number" ? params.perPage : undefined;
  const candidate = local ?? configured ?? 20;
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return 20;
  }
  return Math.max(1, Math.min(100, Math.floor(candidate)));
}

export function readPositiveInt(
  value: unknown,
  options: { fallback: number; min: number; max: number; allowZero?: boolean },
): number {
  const min = options.allowZero ? Math.min(0, options.min) : Math.max(1, options.min);
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    return options.fallback;
  }
  return Math.max(min, Math.min(options.max, Math.floor(value)));
}

export function computeRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.floor(asSeconds * 1000);
  }
  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return undefined;
}

export function parseExpiresAtMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveDigestDateRange(params: {
  window: "today" | "week";
  now: Date;
}): { start: Date; end: Date } {
  const start = new Date(params.now);
  if (params.window === "today") {
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
  }
  return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) };
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDueLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function buildAcademicDigest(params: {
  items: Array<{
    courseId: string;
    courseName: string;
    assignmentId: string;
    assignmentName: string;
    dueAt: string;
    htmlUrl?: string;
  }>;
  window: "today" | "week";
  now: Date;
  timeZone: string;
}): string {
  const label = params.window === "today" ? "today" : "next 7 days";
  if (params.items.length === 0) {
    return `Academic sync (${label}): no assignments due.`;
  }

  const lines: string[] = [`Academic sync (${label})`, `Total due: ${params.items.length}`];
  const byDay = new Map<string, typeof params.items>();
  for (const item of params.items) {
    const dayKey = formatDateInTimeZone(new Date(item.dueAt), params.timeZone);
    byDay.set(dayKey, [...(byDay.get(dayKey) ?? []), item]);
  }
  const sortedDays = Array.from(byDay.keys()).sort();
  for (const day of sortedDays) {
    lines.push(`- ${day}`);
    const dayItems = (byDay.get(day) ?? []).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    for (const item of dayItems) {
      const dueLabel = formatDueLabel(new Date(item.dueAt), params.timeZone);
      const urlPart = item.htmlUrl ? ` (${item.htmlUrl})` : "";
      lines.push(`  - ${dueLabel} | ${item.courseName} | ${item.assignmentName}${urlPart}`);
    }
  }
  lines.push(`Generated at: ${params.now.toISOString()}`);
  return lines.join("\n");
}
