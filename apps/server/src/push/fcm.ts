import { importPKCS8, SignJWT } from "jose";

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
}

export type FcmResult = { ok: true } | { ok: false; unregistered: boolean; error: string };

/**
 * Sends to Firebase Cloud Messaging (HTTP v1) using a service account, so the
 * server needs no Expo account. The OAuth access token is minted from a signed
 * JWT and cached until shortly before it expires.
 */
export class FcmClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromEnv(raw: string | undefined, fetchImpl: typeof fetch = fetch): FcmClient | null {
    if (!raw) return null;
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const account = JSON.parse(json) as ServiceAccount;
    if (!account.project_id || !account.client_email || !account.private_key) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key");
    return new FcmClient({ ...account, private_key: account.private_key.replace(/\\n/g, "\n") }, fetchImpl);
  }

  get projectId(): string {
    return this.account.project_id;
  }

  async send(message: FcmMessage): Promise<FcmResult> {
    const token = await this.getAccessToken();
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(message.data ?? {})) data[k] = typeof v === "string" ? v : JSON.stringify(v);
    const res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token: message.token,
          notification: { title: message.title, body: message.body },
          data,
          android: {
            priority: "HIGH",
            notification: { channel_id: message.channelId ?? "messages", sound: "default", default_vibrate_timings: true },
          },
        },
      }),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    const unregistered = res.status === 404 || /UNREGISTERED|NOT_FOUND|InvalidRegistration/i.test(text);
    return { ok: false, unregistered, error: `${res.status} ${text.slice(0, 200)}` };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const tokenUri = this.account.token_uri ?? "https://oauth2.googleapis.com/token";
    const key = await importPKCS8(this.account.private_key, "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.account.client_email)
      .setSubject(this.account.client_email)
      .setAudience(tokenUri)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    const res = await this.fetchImpl(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }
}

/** Expo tokens look like ExponentPushToken[xxx]; anything else is a raw FCM device token. */
export function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[/.test(token);
}
