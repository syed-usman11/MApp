import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { schema, type Db } from "../db/index.js";
import { isExpoToken, type FcmClient } from "./fcm.js";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** iOS badge count; omitted when unknown. */
  badge?: number;
  /** "call" uses a longer, louder presentation on the client. */
  channelId?: "messages" | "calls";
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type Log = { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };

/**
 * Delivers notifications to every device of the target users. Two transports:
 * raw FCM device tokens go straight to Firebase through the service account
 * (Android, no Expo account needed); Expo push tokens go through Expo's
 * service (iOS, or Android builds linked to an EAS project). Fire-and-forget:
 * a failed send is logged, never surfaced to the sender. Tokens reported dead
 * are cleared so we stop retrying them.
 */
export class PushService {
  constructor(
    private readonly db: Db,
    private readonly log: Log,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly enabled = true,
    private readonly fcm: FcmClient | null = null,
  ) {}

  get fcmConfigured(): boolean {
    return this.fcm !== null;
  }

  async registerToken(userId: string, deviceId: string, token: string | null): Promise<void> {
    await this.db
      .update(schema.devices)
      .set({ pushToken: token })
      .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId)));
  }

  /** Every live push token across the given users' devices. */
  async tokensFor(userIds: string[]): Promise<Array<{ token: string; userId: string }>> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({ token: schema.devices.pushToken, userId: schema.devices.userId })
      .from(schema.devices)
      .where(and(inArray(schema.devices.userId, userIds), isNotNull(schema.devices.pushToken), isNull(schema.devices.revokedAt)));
    return rows.flatMap((r) => (r.token ? [{ token: r.token, userId: r.userId }] : []));
  }

  /** Sends `message` to every device of every user in `userIds`. Never throws. */
  notify(userIds: string[], message: PushMessage): void {
    if (!this.enabled || userIds.length === 0) return;
    void this.deliver(userIds, message).catch((err) => this.log.warn({ err }, "push delivery failed"));
  }

  private async deliver(userIds: string[], message: PushMessage): Promise<void> {
    const targets = await this.tokensFor(userIds);
    if (targets.length === 0) return;
    const expo = targets.filter((t) => isExpoToken(t.token));
    const fcm = targets.filter((t) => !isExpoToken(t.token));
    const dead: string[] = [];
    await Promise.all([this.viaExpo(expo, message, dead), this.viaFcm(fcm, message, dead)]);
    if (dead.length > 0) {
      await this.db.update(schema.devices).set({ pushToken: null }).where(inArray(schema.devices.pushToken, dead));
      this.log.info({ count: dead.length }, "cleared unregistered push tokens");
    }
  }

  private async viaExpo(targets: Array<{ token: string }>, message: PushMessage, dead: string[]): Promise<void> {
    if (targets.length === 0) return;
    const payload = targets.map((t) => ({
      to: t.token,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sound: "default",
      priority: "high",
      channelId: message.channelId ?? "messages",
      ...(message.badge !== undefined ? { badge: message.badge } : {}),
    }));
    const res = await this.fetchImpl(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      this.log.warn({ status: res.status }, "expo push rejected the batch");
      return;
    }
    const json = (await res.json()) as { data?: ExpoTicket[] };
    json.data?.forEach((ticket, i) => {
      if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") dead.push(targets[i]!.token);
    });
  }

  private async viaFcm(targets: Array<{ token: string }>, message: PushMessage, dead: string[]): Promise<void> {
    if (targets.length === 0) return;
    if (!this.fcm) {
      this.log.warn({ count: targets.length }, "devices have FCM tokens but FIREBASE_SERVICE_ACCOUNT is not set; notifications not sent");
      return;
    }
    await Promise.all(
      targets.map(async (t) => {
        const result = await this.fcm!.send({ token: t.token, title: message.title, body: message.body, data: message.data, channelId: message.channelId ?? "messages" });
        if (!result.ok) {
          if (result.unregistered) dead.push(t.token);
          else this.log.warn({ error: result.error }, "fcm send failed");
        }
      }),
    );
  }
}
