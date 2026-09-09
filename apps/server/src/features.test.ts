import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { MockProvider, ProviderRegistry } from "@mapp/identity";
import type { Conversation, IdentityCompleteResponse, Message, ServerEvent } from "@mapp/protocol";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectDb, type DbHandle } from "./db/index.js";
import { AesGcmVault } from "./identity/vault.js";
import { createMailer, ResendMailer, SmtpMailer } from "./mail/mailer.js";
import { FcmClient, isExpoToken } from "./push/fcm.js";
import { generateKeyPairSync } from "node:crypto";

const baseEnv = {
  NODE_ENV: "test",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough",
  IDENTITY_PEPPER: "test-pepper-that-is-long-enough",
  PUBLIC_URL: "http://localhost:4000",
  APP_REDIRECT_URL: "mapp://auth",
  IDENTITY_PROVIDERS: "mock",
  PUSH_ENABLED: "true",
  MEDIA_MAX_MB: "1",
};

interface PushCall {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

const device = { platform: "android", name: "Pixel" };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("groups, media, message actions, search, push and calls", () => {
  let app: FastifyInstance;
  let dbHandle: DbHandle;
  let baseUrl: string;
  const pushed: PushCall[] = [];
  let alice: IdentityCompleteResponse;
  let bob: IdentityCompleteResponse;
  let carol: IdentityCompleteResponse;

  const pushFetch: typeof fetch = async (_url, init) => {
    const batch = JSON.parse(String(init?.body)) as PushCall[];
    pushed.push(...batch);
    return new Response(JSON.stringify({ data: batch.map(() => ({ status: "ok", id: "t" })) }), { status: 200 });
  };

  async function signup(fullName: string, idNumber: string, email: string, username: string): Promise<IdentityCompleteResponse> {
    const start = await app.inject({ method: "POST", url: "/v1/identity/start", payload: { method: "mock", device, signup: { email, password: "a-long-password" } } });
    const { sessionId } = start.json();
    const done = await app.inject({ method: "POST", url: "/v1/identity/complete", payload: { sessionId, input: { fullName, dateOfBirth: "1990-01-02", idNumber } } });
    expect(done.statusCode).toBe(200);
    const auth = done.json() as IdentityCompleteResponse;
    const r = await app.inject({ method: "PATCH", url: "/v1/me", headers: bearer(auth.tokens.accessToken), payload: { username } });
    expect(r.statusCode).toBe(200);
    return auth;
  }

  function connect(token: string) {
    const ws = new WebSocket(`${baseUrl.replace("http", "ws")}/ws`);
    const queue: ServerEvent[] = [];
    const waiters: Array<(e: ServerEvent) => void> = [];
    ws.on("message", (raw) => {
      const ev = JSON.parse(raw.toString()) as ServerEvent;
      const w = waiters.shift();
      if (w) w(ev);
      else queue.push(ev);
    });
    const next = () =>
      new Promise<ServerEvent>((resolve, reject) => {
        const q = queue.shift();
        if (q) return resolve(q);
        const t = setTimeout(() => reject(new Error("timed out waiting for event")), 5000);
        waiters.push((e) => {
          clearTimeout(t);
          resolve(e);
        });
      });
    const nextOfType = async <T extends ServerEvent["type"]>(type: T): Promise<Extract<ServerEvent, { type: T }>> => {
      for (;;) {
        const e = await next();
        if (e.type === type) return e as Extract<ServerEvent, { type: T }>;
      }
    };
    const send = (e: unknown) => ws.send(JSON.stringify(e));
    const ready = new Promise<void>((resolve) => {
      ws.once("open", () => {
        send({ type: "auth", token });
        resolve();
      });
    });
    const authed = (async () => {
      await ready;
      await nextOfType("ready");
    })();
    return { ws, next, nextOfType, send, authed, close: () => ws.close() };
  }

  beforeAll(async () => {
    const config = loadConfig(baseEnv);
    dbHandle = await connectDb();
    const registry = new ProviderRegistry().register(new MockProvider());
    app = await buildApp({ config, db: dbHandle.db, registry, vault: AesGcmVault.deriveFrom("t"), logger: false, pushFetch });
    await app.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    baseUrl = `http://127.0.0.1:${address.port}`;
    alice = await signup("Alice", "200000000001", "alice2@example.com", "alice");
    bob = await signup("Bob", "200000000002", "bob2@example.com", "bob");
    carol = await signup("Carol", "200000000003", "carol2@example.com", "carol");
  });
  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  let group: Conversation;

  it("creates a group with the creator as admin and announces it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/conversations/group",
      headers: bearer(alice.tokens.accessToken),
      payload: { name: "Weekend plans", memberIds: [bob.user.id, carol.user.id] },
    });
    expect(res.statusCode).toBe(200);
    group = res.json();
    expect(group.type).toBe("group");
    expect(group.name).toBe("Weekend plans");
    expect(group.members.find((m) => m.id === alice.user.id)?.role).toBe("admin");
    expect(group.members.find((m) => m.id === bob.user.id)?.role).toBe("member");
    expect(group.lastMessage?.contentType).toBe("system");
    expect(group.unreadCount).toBe(0);
  });

  it("only admins rename or add members; anyone can leave", async () => {
    const denied = await app.inject({ method: "PATCH", url: `/v1/conversations/${group.id}`, headers: bearer(bob.tokens.accessToken), payload: { name: "Hijacked" } });
    expect(denied.statusCode).toBe(403);

    const b = connect(bob.tokens.accessToken);
    await b.authed;
    const renamed = await app.inject({ method: "PATCH", url: `/v1/conversations/${group.id}`, headers: bearer(alice.tokens.accessToken), payload: { name: "Beach trip" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("Beach trip");
    const update = await b.nextOfType("conversation.updated");
    expect(update.conversation.name).toBe("Beach trip");
    expect(update.removed).toBe(false);

    const dave = await signup("Dave", "200000000004", "dave2@example.com", "dave");
    const added = await app.inject({ method: "POST", url: `/v1/conversations/${group.id}/members`, headers: bearer(alice.tokens.accessToken), payload: { memberIds: [dave.user.id] } });
    expect(added.statusCode).toBe(200);
    expect(added.json().members).toHaveLength(4);

    const left = await app.inject({ method: "DELETE", url: `/v1/conversations/${group.id}/members/${dave.user.id}`, headers: bearer(dave.tokens.accessToken) });
    expect(left.statusCode).toBe(200);
    const listForDave = await app.inject({ method: "GET", url: "/v1/conversations", headers: bearer(dave.tokens.accessToken) });
    expect(listForDave.json().conversations).toHaveLength(0);

    const kicked = await app.inject({ method: "DELETE", url: `/v1/conversations/${group.id}/members/${carol.user.id}`, headers: bearer(bob.tokens.accessToken) });
    expect(kicked.statusCode).toBe(403);
    b.close();
  });

  let photo: { mediaId: string; url: string };

  it("uploads a photo and serves it through a signed link", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/media",
      headers: { ...bearer(alice.tokens.accessToken), "content-type": "image/png", "x-file-name": "beach.png", "x-width": "640", "x-height": "480" },
      payload: bytes,
    });
    expect(res.statusCode).toBe(200);
    photo = res.json();
    expect(photo.url).toContain(`/v1/media/${photo.mediaId}?exp=`);
    expect(res.json().width).toBe(640);

    const path = photo.url.replace("http://localhost:4000", "");
    const download = await app.inject({ method: "GET", url: path });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("image/png");
    expect(download.rawPayload.equals(bytes)).toBe(true);

    const tampered = await app.inject({ method: "GET", url: path.replace(/sig=.+$/, "sig=nope") });
    expect(tampered.statusCode).toBe(403);

    const huge = await app.inject({
      method: "POST",
      url: "/v1/media",
      headers: { ...bearer(alice.tokens.accessToken), "content-type": "application/pdf" },
      payload: Buffer.alloc(1024 * 1024 + 2048),
    });
    expect(huge.statusCode).toBe(413);
  });

  it("sends attachments and replies, edits, reacts, and deletes for me or everyone", async () => {
    const a = connect(alice.tokens.accessToken);
    const b = connect(bob.tokens.accessToken);
    await Promise.all([a.authed, b.authed]);

    a.send({ type: "message.send", clientId: "p1", conversationId: group.id, body: "Look at this", contentType: "image", attachment: { mediaId: photo.mediaId, mime: "image/png", name: "beach.png", size: 9, width: 640, height: 480 } });
    const sent = await a.nextOfType("message.sent");
    expect(sent.message.contentType).toBe("image");
    expect(sent.message.attachment?.url).toContain("/v1/media/");
    const seen = await b.nextOfType("message.new");
    expect(seen.message.id).toBe(sent.message.id);

    // Bob cannot attach Alice's upload.
    b.send({ type: "message.send", clientId: "p2", conversationId: group.id, contentType: "image", attachment: { mediaId: photo.mediaId, mime: "image/png", name: "x", size: 9 } });
    expect((await b.nextOfType("error")).code).toBe("FORBIDDEN");

    b.send({ type: "message.send", clientId: "r1", conversationId: group.id, body: "Nice!", replyToId: sent.message.id });
    const reply = await b.nextOfType("message.sent");
    expect(reply.message.replyTo).toMatchObject({ id: sent.message.id, senderId: alice.user.id, body: "Look at this" });
    await a.nextOfType("message.new");

    b.send({ type: "message.edit", messageId: reply.message.id, body: "Very nice!" });
    const edited = await a.nextOfType("message.edited");
    expect(edited.message.body).toBe("Very nice!");
    expect(edited.message.editedAt).toBeTruthy();
    await b.nextOfType("message.edited");

    a.send({ type: "message.edit", messageId: reply.message.id, body: "not mine" });
    expect((await a.nextOfType("error")).code).toBe("FORBIDDEN");

    a.send({ type: "reaction", messageId: reply.message.id, emoji: "👍" });
    const reaction = await b.nextOfType("reaction");
    expect(reaction).toMatchObject({ messageId: reply.message.id, userId: alice.user.id, emoji: "👍" });
    await a.nextOfType("reaction");

    // Delete for me: hidden from Bob only.
    b.send({ type: "message.delete", messageId: sent.message.id, scope: "me" });
    expect(await b.nextOfType("message.deleted")).toMatchObject({ messageId: sent.message.id });
    const bobHistory = (await app.inject({ method: "GET", url: `/v1/conversations/${group.id}/messages`, headers: bearer(bob.tokens.accessToken) })).json();
    expect(bobHistory.messages.some((m: Message) => m.id === sent.message.id)).toBe(false);
    const aliceHistory = (await app.inject({ method: "GET", url: `/v1/conversations/${group.id}/messages`, headers: bearer(alice.tokens.accessToken) })).json();
    const stillThere = aliceHistory.messages.find((m: Message) => m.id === sent.message.id);
    expect(stillThere.attachment.url).toContain("/v1/media/");
    const withReaction = aliceHistory.messages.find((m: Message) => m.id === reply.message.id);
    expect(withReaction.reactions).toEqual([{ userId: alice.user.id, emoji: "👍" }]);

    // Delete for everyone: tombstone broadcast; only the sender or an admin may do it.
    a.send({ type: "message.delete", messageId: reply.message.id, scope: "everyone" });
    expect(await b.nextOfType("message.deleted")).toMatchObject({ messageId: reply.message.id });
    await a.nextOfType("message.deleted");
    const after = (await app.inject({ method: "GET", url: `/v1/conversations/${group.id}/messages`, headers: bearer(bob.tokens.accessToken) })).json();
    const tomb = after.messages.find((m: Message) => m.id === reply.message.id);
    expect(tomb.deleted).toBe(true);
    expect(tomb.body).toBe("");
    expect(tomb.reactions).toEqual([]);

    a.close();
    b.close();
  });

  it("searches messages and conversations", async () => {
    const a = connect(alice.tokens.accessToken);
    await a.authed;
    a.send({ type: "message.send", clientId: "s1", conversationId: group.id, body: "Bring sunscreen and towels" });
    await a.nextOfType("message.sent");
    a.close();

    const res = await app.inject({ method: "GET", url: "/v1/search?q=sunscreen", headers: bearer(bob.tokens.accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages.map((m: Message) => m.body)).toEqual(["Bring sunscreen and towels"]);

    const byName = await app.inject({ method: "GET", url: "/v1/search?q=beach", headers: bearer(alice.tokens.accessToken) });
    expect(byName.json().conversations.map((c: Conversation) => c.name)).toEqual(["Beach trip"]);
    expect(byName.json().messages.map((m: Message) => m.attachment?.name)).toEqual(["beach.png"]);
    // Bob deleted that photo "for me" earlier, so his search must not surface it.
    const hidden = await app.inject({ method: "GET", url: "/v1/search?q=beach", headers: bearer(bob.tokens.accessToken) });
    expect(hidden.json().messages).toEqual([]);

    const outsider = await app.inject({ method: "GET", url: "/v1/search?q=sunscreen", headers: bearer((await signup("Eve", "200000000005", "eve2@example.com", "eve")).tokens.accessToken) });
    expect(outsider.json().messages).toEqual([]);
  });

  it("marks a whole conversation read over HTTP and notifies the senders", async () => {
    const a = connect(alice.tokens.accessToken);
    await a.authed;
    a.send({ type: "message.send", clientId: "u1", conversationId: group.id, body: "Unread one" });
    await a.nextOfType("message.sent");
    a.send({ type: "message.send", clientId: "u2", conversationId: group.id, body: "Unread two" });
    await a.nextOfType("message.sent");

    const before = (await app.inject({ method: "GET", url: "/v1/conversations", headers: bearer(carol.tokens.accessToken) })).json();
    expect(before.conversations.find((c: Conversation) => c.id === group.id).unreadCount).toBeGreaterThanOrEqual(2);

    const read = await app.inject({ method: "POST", url: `/v1/conversations/${group.id}/read`, headers: bearer(carol.tokens.accessToken) });
    expect(read.statusCode).toBe(200);
    expect(read.json().count).toBeGreaterThanOrEqual(2);
    // Alice, the sender, sees the read receipts arrive live.
    expect(await a.nextOfType("receipt")).toMatchObject({ conversationId: group.id, userId: carol.user.id, kind: "read" });

    const after = (await app.inject({ method: "GET", url: "/v1/conversations", headers: bearer(carol.tokens.accessToken) })).json();
    expect(after.conversations.find((c: Conversation) => c.id === group.id).unreadCount).toBe(0);
    // Idempotent: a second call finds nothing new and keeps the count at zero.
    expect((await app.inject({ method: "POST", url: `/v1/conversations/${group.id}/read`, headers: bearer(carol.tokens.accessToken) })).json().count).toBe(0);
    a.close();
  });

  it("pushes to offline members with an unread badge, and reports unread totals", async () => {
    const reg = await app.inject({ method: "POST", url: "/v1/devices/push-token", headers: bearer(carol.tokens.accessToken), payload: { token: "ExponentPushToken[carol]" } });
    expect(reg.statusCode).toBe(200);
    pushed.length = 0;

    const a = connect(alice.tokens.accessToken);
    await a.authed;
    a.send({ type: "message.send", clientId: "n1", conversationId: group.id, body: "Carol, are you coming?" });
    await a.nextOfType("message.sent");
    a.close();

    for (let i = 0; i < 50 && pushed.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ to: "ExponentPushToken[carol]", title: "Beach trip", body: "Alice: Carol, are you coming?", data: { conversationId: group.id, kind: "message" } });

    const unread = await app.inject({ method: "GET", url: "/v1/unread", headers: bearer(carol.tokens.accessToken) });
    // Everything earlier was marked read by the previous test; only the message just sent is unread.
    expect(unread.json().total).toBe(1);

    const cleared = await app.inject({ method: "POST", url: "/v1/devices/push-token", headers: bearer(carol.tokens.accessToken), payload: { token: null } });
    expect(cleared.statusCode).toBe(200);
  });

  it("signals a voice call end to end and logs it", async () => {
    const direct = (await app.inject({ method: "POST", url: "/v1/conversations/direct", headers: bearer(alice.tokens.accessToken), payload: { username: "bob" } })).json() as Conversation;
    const a = connect(alice.tokens.accessToken);
    const b = connect(bob.tokens.accessToken);
    await Promise.all([a.authed, b.authed]);

    a.send({ type: "call.invite", conversationId: direct.id, sdp: { type: "offer", sdp: "v=0 offer" } });
    const ringing = await a.nextOfType("call.ringing");
    const incoming = await b.nextOfType("call.incoming");
    expect(incoming.callId).toBe(ringing.callId);
    expect(incoming.from.id).toBe(alice.user.id);
    expect(incoming.sdp.sdp).toBe("v=0 offer");

    b.send({ type: "call.answer", callId: incoming.callId, sdp: { type: "answer", sdp: "v=0 answer" } });
    expect((await a.nextOfType("call.answered")).sdp.sdp).toBe("v=0 answer");

    a.send({ type: "call.ice", callId: incoming.callId, candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } });
    expect((await b.nextOfType("call.ice")).candidate.candidate).toBe("candidate:1");

    // Renegotiation after an ICE restart is relayed untouched, both directions.
    a.send({ type: "call.sdp", callId: incoming.callId, sdp: { type: "offer", sdp: "v=0 restart" } });
    expect((await b.nextOfType("call.sdp")).sdp).toEqual({ type: "offer", sdp: "v=0 restart" });
    b.send({ type: "call.sdp", callId: incoming.callId, sdp: { type: "answer", sdp: "v=0 restart-answer" } });
    expect((await a.nextOfType("call.sdp")).sdp.type).toBe("answer");

    const ice = await app.inject({ method: "GET", url: "/v1/calls/ice", headers: bearer(alice.tokens.accessToken) });
    expect(ice.statusCode).toBe(200);
    expect(ice.json().iceServers[0].urls[0]).toMatch(/^stun:/);

    a.send({ type: "call.hold", callId: incoming.callId, onHold: true });
    expect(await b.nextOfType("call.hold")).toMatchObject({ callId: incoming.callId, userId: alice.user.id, onHold: true });

    b.send({ type: "call.end", callId: incoming.callId, reason: "hangup" });
    expect(await a.nextOfType("call.ended")).toMatchObject({ callId: incoming.callId, reason: "hangup" });
    expect(await b.nextOfType("call.ended")).toMatchObject({ callId: incoming.callId });

    const history = await app.inject({ method: "GET", url: "/v1/calls", headers: bearer(bob.tokens.accessToken) });
    expect(history.json().calls[0]).toMatchObject({ status: "ended", peer: { id: alice.user.id } });
    expect(history.json().calls[0].answeredAt).toBeTruthy();

    // Calling someone with no socket sends a wake-up push and keeps ringing.
    b.close();
    await new Promise((r) => setTimeout(r, 50));
    await app.inject({ method: "POST", url: "/v1/devices/push-token", headers: bearer(bob.tokens.accessToken), payload: { token: "ExponentPushToken[bob]" } });
    pushed.length = 0;
    a.send({ type: "call.invite", conversationId: direct.id, sdp: { type: "offer", sdp: "again" } });
    const ringing2 = await a.nextOfType("call.ringing");
    for (let i = 0; i < 50 && pushed.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(pushed[0]).toMatchObject({ to: "ExponentPushToken[bob]", data: { kind: "call", callId: ringing2.callId } });
    a.send({ type: "call.end", callId: ringing2.callId, reason: "hangup" });
    expect(await a.nextOfType("call.ended")).toMatchObject({ callId: ringing2.callId });
    a.close();
  });
});

describe("password reset email transport", () => {
  it("refuses to hand out reset codes in production when no transport is configured", async () => {
    const config = loadConfig({ ...baseEnv, NODE_ENV: "production", IDENTITY_PROVIDERS: "mock" });
    const dbHandle = await connectDb();
    const registry = new ProviderRegistry().register(new MockProvider());
    const app = await buildApp({ config, db: dbHandle.db, registry, vault: AesGcmVault.deriveFrom("t"), logger: false });
    await app.ready();
    try {
      const res = await app.inject({ method: "POST", url: "/v1/auth/forgot", payload: { email: "someone@example.com" } });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("MAIL_NOT_CONFIGURED");
    } finally {
      await app.close();
      await dbHandle.close();
    }
  });

  it("sends through Resend when an API key is configured", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    };
    const mailer = new ResendMailer("re_test", "MApp <no-reply@example.com>", fakeFetch);
    await mailer.send({ to: "someone@example.com", subject: "Code", text: "123456" });
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.body).toMatchObject({ from: "MApp <no-reply@example.com>", to: ["someone@example.com"], subject: "Code" });
  });

  it("picks the transport from configuration", () => {
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
    expect(createMailer({}, log, false).delivers).toBe(false);
    expect(createMailer({ resendApiKey: "re_x" }, log, true)).toBeInstanceOf(ResendMailer);
    expect(createMailer({ smtpHost: "smtp.example.com", smtpPort: 465, smtpUser: "u", smtpPass: "p" }, log, true)).toBeInstanceOf(SmtpMailer);
  });
});

describe("android push through Firebase Cloud Messaging", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const account = { project_id: "mapp-test", client_email: "push@mapp-test.iam.gserviceaccount.com", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" };

  it("exchanges a signed JWT for an access token once, then posts messages", async () => {
    const calls: Array<{ url: string; body: string; auth?: string }> = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), body: String(init?.body), auth: headers.authorization });
      if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ name: "projects/mapp-test/messages/1" }), { status: 200 });
    };
    const fcm = new FcmClient(account, fakeFetch);
    expect(await fcm.send({ token: "fcm-device-1", title: "Alice", body: "hello", data: { conversationId: "c1" } })).toEqual({ ok: true });
    expect(await fcm.send({ token: "fcm-device-1", title: "Alice", body: "again" })).toEqual({ ok: true });
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    const sends = calls.filter((c) => c.url.includes("fcm.googleapis.com"));
    expect(sends).toHaveLength(2);
    expect(sends[0]?.auth).toBe("Bearer ya29.test");
    const body = JSON.parse(sends[0]!.body);
    expect(body.message).toMatchObject({ token: "fcm-device-1", notification: { title: "Alice", body: "hello" }, data: { conversationId: "c1" } });
    expect(body.message.android.notification.channel_id).toBe("messages");
    const assertion = new URLSearchParams(calls[0]!.body).get("assertion") ?? "";
    expect(assertion.split(".")).toHaveLength(3);
  });

  it("reports unregistered tokens so they get cleared", async () => {
    const fakeFetch: typeof fetch = async (url) => {
      if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), { status: 404 });
    };
    const res = await new FcmClient(account, fakeFetch).send({ token: "gone", title: "x", body: "y" });
    expect(res).toMatchObject({ ok: false, unregistered: true });
  });

  it("tells Expo tokens and raw FCM tokens apart", () => {
    expect(isExpoToken("ExponentPushToken[abc]")).toBe(true);
    expect(isExpoToken("ExpoPushToken[abc]")).toBe(true);
    expect(isExpoToken("dGhpcyBpcyBhIGZjbSB0b2tlbg:APA91b")).toBe(false);
  });
});
