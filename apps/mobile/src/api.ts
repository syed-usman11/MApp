import type { RefreshResponse } from "@mapp/protocol";
import { API_URL, IS_DEV_BUILD } from "./config";
import { useSession } from "./session";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

const TIMEOUT_MS = 12_000;

export const NETWORK_HINT = IS_DEV_BUILD
  ? `Cannot reach the server at ${API_URL}. On a phone, make sure it shares Wi-Fi with the PC running the server and that the firewall allows port 4000.`
  : `Cannot reach the server at ${API_URL}. Check your internet connection and try again.`;

/** fetch with a hard timeout; any transport failure becomes one clear, actionable ApiError. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new ApiError(0, "NETWORK", NETWORK_HINT);
  } finally {
    clearTimeout(timer);
  }
}

/** True when the API answers its health check. Used by the welcome screen as a connectivity hint. */
export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Attach the access token. Defaults to true. */
  auth?: boolean;
}

let refreshing: Promise<string | null> | null = null;

/** Exchanges the long-lived device token for a fresh access token. De-duplicated across callers. */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { tokens, setAccessToken } = useSession.getState();
    if (!tokens) return null;
    try {
      const res = await fetchWithTimeout(`${API_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: tokens.deviceId, deviceToken: tokens.deviceToken }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as RefreshResponse;
      await setAccessToken(json.accessToken, json.accessExpiresAt);
      return json.accessToken;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function ensureFreshAccessToken(): Promise<string | null> {
  const { tokens } = useSession.getState();
  if (!tokens) return null;
  const expiresIn = new Date(tokens.accessExpiresAt).getTime() - Date.now();
  if (expiresIn > 30_000) return tokens.accessToken;
  return refreshAccessToken();
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const withAuth = opts.auth ?? true;
  const send = async (token: string | null) =>
    fetchWithTimeout(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let res = await send(withAuth ? await ensureFreshAccessToken() : null);
  if (res.status === 401 && withAuth && useSession.getState().tokens) {
    const token = await refreshAccessToken();
    if (token) res = await send(token);
  }

  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = res.statusText || "Request failed";
    try {
      const json = (await res.json()) as { error?: { code?: string; message?: string } };
      code = json.error?.code ?? code;
      message = json.error?.message ?? message;
    } catch {
      // non-JSON error body
    }
    if (res.status === 401 && withAuth) await useSession.getState().signOut();
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}
