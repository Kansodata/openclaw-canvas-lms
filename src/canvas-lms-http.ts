import {
  DEFAULT_MAX_PAGES,
  computeRetryAfterMs,
  extractNextLink,
  redactSensitive,
  sleep,
} from "./canvas-lms-utils.ts";

export type FetchLike = typeof fetch;

export async function fetchWithRetry(params: {
  fetchImpl: FetchLike;
  url: string;
  token?: string;
  timeoutMs: number;
  maxRetries: number;
  method?: "GET" | "POST";
  body?: URLSearchParams | string;
  headers?: Record<string, string>;
}): Promise<Response> {
  let attempt = 0;
  while (attempt <= params.maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const response = await params.fetchImpl(params.url, {
        method: params.method ?? "GET",
        headers: {
          ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
          Accept: "application/json",
          ...(params.headers ?? {}),
        },
        ...(params.body ? { body: params.body } : {}),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if ((response.status === 429 || response.status >= 500) && attempt < params.maxRetries) {
        const retryAfter = computeRetryAfterMs(response.headers.get("retry-after"));
        const delay = retryAfter ?? Math.min(5_000, 300 * 2 ** attempt);
        await sleep(delay);
        attempt += 1;
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      if (attempt >= params.maxRetries) {
        throw error;
      }
      await sleep(Math.min(2_000, 200 * 2 ** attempt));
      attempt += 1;
    }
  }
  throw new Error("Canvas request failed before receiving a response");
}

export async function fetchPaginatedArray(params: {
  fetchImpl: FetchLike;
  apiBase: string;
  token: string;
  firstPath: string;
  maxPages?: number;
  timeoutMs: number;
  maxRetries: number;
}): Promise<unknown[]> {
  const out: unknown[] = [];
  let nextUrl = `${params.apiBase}${params.firstPath}`;
  let pages = 0;
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES;

  while (nextUrl && pages < maxPages) {
    const response = await fetchWithRetry({
      fetchImpl: params.fetchImpl,
      url: nextUrl,
      token: params.token,
      timeoutMs: params.timeoutMs,
      maxRetries: params.maxRetries,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Canvas request failed (${response.status} ${response.statusText}): ${redactSensitive(body).slice(
          0,
          240,
        )}`,
      );
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("Canvas API response was not an array");
    }
    out.push(...payload);
    nextUrl = extractNextLink(response.headers.get("link")) ?? "";
    pages += 1;
  }
  return out;
}
