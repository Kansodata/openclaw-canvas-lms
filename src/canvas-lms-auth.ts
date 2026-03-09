import { fetchWithRetry, type FetchLike } from "./canvas-lms-http.ts";
import {
  type CanvasLmsPluginConfig,
  parseExpiresAtMs,
  readConfigString,
  readString,
  redactSensitive,
} from "./canvas-lms-utils.ts";

type OAuthRuntimeConfig = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
};

type OAuthTokenState = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

const oauthTokenCache = new Map<string, OAuthTokenState>();

export function resolveOAuthConfig(params: {
  pluginConfig: CanvasLmsPluginConfig;
  baseUrl: string;
  allowInsecureHttp: boolean;
}): OAuthRuntimeConfig | undefined {
  const configured = params.pluginConfig.oauth;
  const clientId =
    readConfigString(configured?.clientId) ??
    readConfigString(process.env.CANVAS_LMS_OAUTH_CLIENT_ID);
  const clientSecret =
    readConfigString(configured?.clientSecret) ??
    readConfigString(process.env.CANVAS_LMS_OAUTH_CLIENT_SECRET);
  const refreshToken =
    readConfigString(configured?.refreshToken) ??
    readConfigString(process.env.CANVAS_LMS_OAUTH_REFRESH_TOKEN);
  const accessToken =
    readConfigString(configured?.accessToken) ??
    readConfigString(process.env.CANVAS_LMS_OAUTH_ACCESS_TOKEN);
  const expiresAt = parseExpiresAtMs(
    configured?.expiresAt ?? process.env.CANVAS_LMS_OAUTH_EXPIRES_AT,
  );
  const tokenUrlRaw =
    readConfigString(configured?.tokenUrl) ??
    readConfigString(process.env.CANVAS_LMS_OAUTH_TOKEN_URL) ??
    `${params.baseUrl}/login/oauth2/token`;

  if (!clientId || !clientSecret) {
    return undefined;
  }

  let tokenUrl: URL;
  try {
    tokenUrl = new URL(tokenUrlRaw);
  } catch {
    throw new Error(`Invalid Canvas OAuth tokenUrl: ${tokenUrlRaw}`);
  }
  if (tokenUrl.protocol !== "https:") {
    if (tokenUrl.protocol !== "http:") {
      throw new Error("Canvas OAuth tokenUrl must use https://");
    }
    if (!params.allowInsecureHttp) {
      throw new Error("Canvas OAuth tokenUrl must use https:// (http:// is disabled by default)");
    }
  }

  if (!accessToken && !refreshToken) {
    throw new Error(
      "Canvas OAuth is configured but no accessToken/refreshToken found. Set oauth.refreshToken or CANVAS_LMS_OAUTH_REFRESH_TOKEN.",
    );
  }

  return {
    tokenUrl: tokenUrl.toString(),
    clientId,
    clientSecret,
    refreshToken,
    accessToken,
    expiresAt,
  };
}

function oauthCacheKey(config: OAuthRuntimeConfig): string {
  const suffix = (config.refreshToken ?? "no-refresh").slice(-8);
  return `${config.tokenUrl}|${config.clientId}|${suffix}`;
}

export function shouldRefreshToken(state: {
  accessToken: string;
  expiresAt?: number;
}): boolean {
  if (!state.accessToken) {
    return true;
  }
  if (!state.expiresAt) {
    return false;
  }
  return Date.now() >= state.expiresAt - 60_000;
}

async function refreshOAuthToken(params: {
  fetchImpl: FetchLike;
  config: OAuthRuntimeConfig;
  timeoutMs: number;
  maxRetries: number;
}): Promise<OAuthTokenState> {
  if (!params.config.refreshToken) {
    throw new Error("Canvas OAuth access token expired and no refreshToken is configured.");
  }
  const response = await fetchWithRetry({
    fetchImpl: params.fetchImpl,
    url: params.config.tokenUrl,
    token: params.config.accessToken ?? "oauth-refresh",
    timeoutMs: params.timeoutMs,
    maxRetries: params.maxRetries,
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.config.refreshToken,
      client_id: params.config.clientId,
      client_secret: params.config.clientSecret,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Canvas OAuth refresh failed (${response.status} ${response.statusText}): ${redactSensitive(body).slice(
        0,
        180,
      )}`,
    );
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const accessToken = readConfigString(payload.access_token);
  if (!accessToken) {
    throw new Error("Canvas OAuth refresh did not return access_token.");
  }
  const expiresInSeconds =
    typeof payload.expires_in === "number" &&
    Number.isFinite(payload.expires_in) &&
    payload.expires_in > 0
      ? payload.expires_in
      : 3600;
  const expiresAt = Date.now() + expiresInSeconds * 1000 - 60_000;
  return {
    accessToken,
    refreshToken: readConfigString(payload.refresh_token) ?? params.config.refreshToken,
    expiresAt,
  };
}

export async function resolveCanvasAuthToken(params: {
  args: Record<string, unknown>;
  pluginConfig: CanvasLmsPluginConfig;
  baseUrl: string;
  allowInsecureHttp: boolean;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: FetchLike;
}): Promise<string> {
  const inlineToken = readString(params.args, "token");
  if (inlineToken && params.pluginConfig.allowInlineToken !== true) {
    throw new Error(
      "Inline token is disabled. Configure OAuth in plugin config/env (recommended) or allowInlineToken=true.",
    );
  }

  const oauth = resolveOAuthConfig({
    pluginConfig: params.pluginConfig,
    baseUrl: params.baseUrl,
    allowInsecureHttp: params.allowInsecureHttp,
  });
  if (oauth) {
    const key = oauthCacheKey(oauth);
    const cached = oauthTokenCache.get(key);
    let state: OAuthTokenState = cached ?? {
      accessToken: oauth.accessToken ?? "",
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
    };
    if (shouldRefreshToken(state)) {
      state = await refreshOAuthToken({
        fetchImpl: params.fetchImpl,
        config: oauth,
        timeoutMs: params.timeoutMs,
        maxRetries: params.maxRetries,
      });
      oauthTokenCache.set(key, state);
    } else if (!cached) {
      oauthTokenCache.set(key, state);
    }
    if (!state.accessToken) {
      throw new Error("Canvas OAuth did not provide an access token.");
    }
    return state.accessToken;
  }

  const manualToken =
    inlineToken ?? params.pluginConfig.token ?? process.env.CANVAS_LMS_TOKEN ?? "";
  if (!manualToken) {
    throw new Error(
      "Canvas credentials are required. Configure OAuth (oauth.clientId/clientSecret + refreshToken) or CANVAS_LMS_TOKEN.",
    );
  }
  return manualToken;
}
