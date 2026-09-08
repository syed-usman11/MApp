import { createHash } from "node:crypto";
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import {
  MockProvider,
  ProviderRegistry,
  type CompleteContext,
  type NationalIdProvider,
  type StartContext,
  type StartResult,
  type VerifiedIdentity,
} from "@mapp/identity";
import type { AuthResponse, IdentityCompleteResponse, ServerEvent } from "@mapp/protocol";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectDb, schema, type DbHandle } from "./db/index.js";
import { AesGcmVault, type Vault } from "./identity/vault.js";
import type { MailMessage, Mailer } from "./mail/mailer.js";

/** A redirect-mode provider standing in for DigiLocker in the callback test. */
class FakeRedirectProvider implements NationalIdProvider {
  readonly id = "fake.redirect";
  readonly country = "IN";
  readonly label = "Fake redirect";
  readonly assurance = "high" as const;
  async start(ctx: StartContext): Promise<StartResult> {
    return { mode: "redirect", url: `https://idp.example/authorize?state=${ctx.state}`, secrets: { verifier: "v1" } };
  }
  async complete(ctx: CompleteContext, input: Record<string, unknown>): Promise<VerifiedIdentity> {
    if (input.state !== ctx.state) throw new Error("state mismatch");
    if (ctx.secrets.verifier !== "v1") throw new Error("secrets not preserved");
    return {
      provider: this.id,
      country: this.country,
      assurance: this.assurance,
      subjectId: `subject-${input.code}`,
      maskedId: "4321",
      fullName: "Redirect User",
      dateOfBirth: "1991-05-05",
      gender: "M",
      photoBase64: null,
      evidence: { code: input.code },
      verifiedAt: new Date().toISOString(),
    };
  }
}

class CapturingMailer implements Mailer {
  readonly delivers = true;
  sent: MailMessage[] = [];
  async send(message: MailMessage) {
    this.sent.push(message);
  }
}

const baseEnv = {
  NODE_ENV: "test",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough",
  IDENTITY_PEPPER: "test-pepper-that-is-long-enough",
  PUBLIC_URL: "http://localhost:4000",
  APP_REDIRECT_URL: "mapp://auth",
  IDENTITY_PROVIDERS: "mock",
};

async function makeApp(overrides: Partial<Record<string, string>> = {}, vault?: Vault) {
  const config = loadConfig({ ...baseEnv, ...overrides });
  const dbHandle = await connectDb();
  const registry = new ProviderRegistry().register(new MockProvider()).register(new FakeRedirectProvider());
  const mailer = new CapturingMailer();
  const app = await buildApp({ config, db: dbHandle.db, registry, vault: vault ?? AesGcmVault.deriveFrom("t"), mailer, logger: false });
  await app.ready();
  return { app, dbHandle, mailer };
}

interface Person {
  fullName: string;
  idNumber: string;
  email: string;
  password: string;
}

const asha: Person = { fullName: "Asha Rao", idNumber: "111122223333", email: "asha@example.com", password: "correct-horse-battery" };
const bob: Person = { fullName: "Bob Kumar", idNumber: "100000000002", email: "bob@example.com", password: "bobs-secret-password" };

const device = { platform: "android", name: "Pixel" };

async function signupMock(app: FastifyInstance, person: Person) {
  const start = await app.inject({
    method: "POST",
    url: "/v1/identity/start",
    payload: { method: "mock", device, signup: { email: person.email, password: person.password } },
  });
  if (start.statusCode !== 200) return start;
  const { sessionId } = start.json();
  return app.inject({
    method: "POST",
    url: "/v1/identity/complete",
    payload: { sessionId, input: { fullName: person.fullName, dateOfBirth: "1990-01-02", idNumber: person.idNumber } },
  });
}

async function login(app: FastifyInstance, email: string, password: string) {
  return app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password, device } });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("sign-up is gated by identity verification", () => {
  let app: FastifyInstance;
  let dbHandle: DbHandle;

  beforeAll(async () => {
    ({ app, dbHandle } = await makeApp());
  });
  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  it("lists identity methods grouped by country", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/identity/methods" });
    expect(res.statusCode).toBe(200);
    expect(res.json().countries.map((c: { code: string }) => c.code).sort()).toEqual(["IN", "ZZ"]);
  });

  it("has no users before anyone verifies", async () => {
    const [row] = await dbHandle.db.select({ n: count() }).from(schema.users);
    expect(row!.n).toBe(0);
  });

  it("rejects sign-up without credentials or with a weak password", async () => {
    const noCreds = await app.inject({ method: "POST", url: "/v1/identity/start", payload: { method: "mock", device } });
    expect(noCreds.statusCode).toBe(400);
    const weak = await app.inject({
      method: "POST",
      url: "/v1/identity/start",
      payload: { method: "mock", device, signup: { email: "x@example.com", password: "short" } },
    });
    expect(weak.statusCode).toBe(400);
  });

  it("creates user, identity and login credential together after a successful verification", async () => {
    const res = await signupMock(app, asha);
    expect(res.statusCode).toBe(200);
    const body = res.json() as IdentityCompleteResponse;
    expect(body.isNewUser).toBe(true);
    expect(body.user.displayName).toBe("Asha Rao");
    expect(body.user.verifiedCountry).toBe("ZZ");
    expect(body.tokens.accessToken).toBeTruthy();

    const [users] = await dbHandle.db.select({ n: count() }).from(schema.users);
    const [identities] = await dbHandle.db.select({ n: count() }).from(schema.identities);
    const [evidence] = await dbHandle.db.select({ n: count() }).from(schema.identityEvidence);
    const [creds] = await dbHandle.db.select({ n: count() }).from(schema.emailCredentials);
    expect([users!.n, identities!.n, evidence!.n, creds!.n]).toEqual([1, 1, 1, 1]);

    const [cred] = await dbHandle.db.select().from(schema.emailCredentials);
    expect(cred!.email).toBe("asha@example.com");
    expect(cred!.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(cred!.passwordHash).not.toContain(asha.password);

    const [session] = await dbHandle.db.select().from(schema.verificationSessions);
    expect(session!.signup).toBeNull();
  });

  it("refuses a second sign-up with the same email before verification even starts", async () => {
    const res = await signupMock(app, { ...asha, idNumber: "999999999999" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EMAIL_TAKEN");
  });

  it("refuses a second sign-up with the same national ID and a different email", async () => {
    const res = await signupMock(app, { ...asha, email: "asha-two@example.com" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("ID_ALREADY_REGISTERED");
    const [users] = await dbHandle.db.select({ n: count() }).from(schema.users);
    expect(users!.n).toBe(1);
  });

  it("rejects a verification session that has already been used", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/v1/identity/start",
      payload: { method: "mock", device, signup: { email: "dev2@example.com", password: "another-password" } },
    });
    const { sessionId } = start.json();
    const payload = { sessionId, input: { fullName: "Dev Two", dateOfBirth: "1992-02-02", idNumber: "999988887777" } };
    expect((await app.inject({ method: "POST", url: "/v1/identity/complete", payload })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/identity/complete", payload })).statusCode).toBe(409);
  });

  it("completes a redirect-mode provider through the callback and a one-time ticket", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/v1/identity/start",
      payload: {
        method: "fake.redirect",
        device: { platform: "web", name: "Chrome" },
        signup: { email: "redirect@example.com", password: "redirect-password" },
        returnUrl: "http://localhost:8081/auth",
      },
    });
    expect(start.statusCode).toBe(200);
    const started = start.json();
    expect(started.mode).toBe("redirect");
    const state = new URL(started.url).searchParams.get("state")!;

    const cb = await app.inject({ method: "GET", url: `/v1/identity/callback/fake.redirect?code=abc&state=${state}` });
    expect(cb.statusCode).toBe(302);
    const location = new URL(cb.headers.location as string);
    expect(location.origin + location.pathname).toBe("http://localhost:8081/auth");
    const ticket = location.searchParams.get("ticket")!;
    expect(ticket).toBeTruthy();

    const wrong = await app.inject({ method: "POST", url: "/v1/identity/complete", payload: { sessionId: started.sessionId, input: { ticket: "bad" } } });
    expect(wrong.statusCode).toBe(403);

    const done = await app.inject({ method: "POST", url: "/v1/identity/complete", payload: { sessionId: started.sessionId, input: { ticket } } });
    expect(done.statusCode).toBe(200);
    expect(done.json().user.verifiedCountry).toBe("IN");

    // The new account can log in with the email/password given at sign-up.
    expect((await login(app, "redirect@example.com", "redirect-password")).statusCode).toBe(200);
  });

  it("refuses return URLs that are not allow-listed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/start",
      payload: {
        method: "fake.redirect",
        device: { platform: "web", name: "Chrome" },
        signup: { email: "evil@example.com", password: "evil-password" },
        returnUrl: "https://evil.example/steal",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("RETURN_URL_NOT_ALLOWED");
  });
});

describe("direct email + password sign-up (ID verification switched off)", () => {
  it("creates an account without an identity row and it can log in", async () => {
    const { app, dbHandle } = await makeApp();
    try {
      const config = await app.inject({ method: "GET", url: "/v1/config" });
      expect(config.json()).toEqual({ idVerificationRequired: false });

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: { displayName: "Dana Direct", email: "Dana@Example.com", password: "dana-password-1", device },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as IdentityCompleteResponse;
      expect(body.isNewUser).toBe(true);
      expect(body.user.displayName).toBe("Dana Direct");
      expect(body.user.verifiedCountry).toBeNull();

      const [users] = await dbHandle.db.select({ n: count() }).from(schema.users);
      const [identities] = await dbHandle.db.select({ n: count() }).from(schema.identities);
      const [creds] = await dbHandle.db.select({ n: count() }).from(schema.emailCredentials);
      expect([users!.n, identities!.n, creds!.n]).toEqual([1, 0, 1]);

      expect((await login(app, "dana@example.com", "dana-password-1")).statusCode).toBe(200);

      const dup = await app.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: { displayName: "Dana Again", email: "dana@example.com", password: "dana-password-2", device },
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe("EMAIL_TAKEN");

      const weak = await app.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: { displayName: "Weak", email: "weak@example.com", password: "short", device },
      });
      expect(weak.statusCode).toBe(400);
    } finally {
      await app.close();
      await dbHandle.close();
    }
  });

  it("is disabled when ID verification is required", async () => {
    const { app, dbHandle } = await makeApp({ ID_VERIFICATION_REQUIRED: "true" });
    try {
      expect((await app.inject({ method: "GET", url: "/v1/config" })).json()).toEqual({ idVerificationRequired: true });
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/signup",
        payload: { displayName: "Nope", email: "nope@example.com", password: "nope-password-1", device },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("ID_VERIFICATION_REQUIRED");
      const [users] = await dbHandle.db.select({ n: count() }).from(schema.users);
      expect(users!.n).toBe(0);
    } finally {
      await app.close();
      await dbHandle.close();
    }
  });
});

describe("email + password login", () => {
  let app: FastifyInstance;
  let dbHandle: DbHandle;
  let mailer: CapturingMailer;

  beforeAll(async () => {
    ({ app, dbHandle, mailer } = await makeApp());
    expect((await signupMock(app, asha)).statusCode).toBe(200);
  });
  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  it("logs in with the right password and exposes the email on /v1/me", async () => {
    const res = await login(app, "Asha@Example.com ", asha.password);
    expect(res.statusCode).toBe(200);
    const body = res.json() as AuthResponse;
    expect(body.user.displayName).toBe("Asha Rao");
    const me = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(body.tokens.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe("asha@example.com");
  });

  it("rejects a wrong password and an unknown email the same way", async () => {
    const wrong = await login(app, asha.email, "nope-nope-nope");
    const unknown = await login(app, "nobody@example.com", "nope-nope-nope");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it("refreshes from the device token and revokes it on logout", async () => {
    const { tokens } = (await login(app, asha.email, asha.password)).json() as AuthResponse;
    const refresh = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { deviceId: tokens.deviceId, deviceToken: tokens.deviceToken } });
    expect(refresh.statusCode).toBe(200);

    const logout = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(tokens.accessToken) });
    expect(logout.statusCode).toBe(200);
    const after = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { deviceId: tokens.deviceId, deviceToken: tokens.deviceToken } });
    expect(after.statusCode).toBe(401);
  });

  it("locks the account after too many failures", async () => {
    const { app: locked, dbHandle: db2 } = await makeApp({ LOGIN_MAX_FAILURES: "3" });
    try {
      expect((await signupMock(locked, bob)).statusCode).toBe(200);
      for (let i = 0; i < 3; i++) expect((await login(locked, bob.email, "wrong-password")).statusCode).toBe(401);
      expect((await login(locked, bob.email, bob.password)).statusCode).toBe(429);
    } finally {
      await locked.close();
      await db2.close();
    }
  });

  it("resets the password with an emailed code and signs out existing sessions", async () => {
    const before = (await login(app, asha.email, asha.password)).json() as AuthResponse;

    const forgot = await app.inject({ method: "POST", url: "/v1/auth/forgot", payload: { email: asha.email } });
    expect(forgot.statusCode).toBe(200);
    expect(forgot.json().ok).toBe(true);
    const mail = mailer.sent.at(-1)!;
    expect(mail.to).toBe(asha.email);
    const code = mail.text.match(/\b(\d{6})\b/)![1]!;
    expect(forgot.json().devCode).toBe(code);

    // Unknown emails get the same answer and no email is sent.
    const sentBefore = mailer.sent.length;
    const unknown = await app.inject({ method: "POST", url: "/v1/auth/forgot", payload: { email: "ghost@example.com" } });
    expect(unknown.statusCode).toBe(200);
    expect(mailer.sent.length).toBe(sentBefore);

    const bad = await app.inject({ method: "POST", url: "/v1/auth/reset", payload: { email: asha.email, code: "000000", newPassword: "brand-new-password" } });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({ method: "POST", url: "/v1/auth/reset", payload: { email: asha.email, code, newPassword: "brand-new-password" } });
    expect(ok.statusCode).toBe(200);

    const reused = await app.inject({ method: "POST", url: "/v1/auth/reset", payload: { email: asha.email, code, newPassword: "yet-another-password" } });
    expect(reused.statusCode).toBe(400);

    expect((await login(app, asha.email, asha.password)).statusCode).toBe(401);
    expect((await login(app, asha.email, "brand-new-password")).statusCode).toBe(200);

    const oldSession = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { deviceId: before.tokens.deviceId, deviceToken: before.tokens.deviceToken },
    });
    expect(oldSession.statusCode).toBe(401);
  });
});

describe("contact discovery", () => {
  it("matches hashed emails and phones of registered users and nothing else", async () => {
    const { app, dbHandle } = await makeApp();
    try {
      const me = (await signupMock(app, asha)).json() as IdentityCompleteResponse;
      const friend = (await signupMock(app, bob)).json() as IdentityCompleteResponse;
      const phoneSet = await app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: bearer(friend.tokens.accessToken),
        payload: { phone: "+919876543210" },
      });
      expect(phoneSet.statusCode).toBe(200);
      expect(phoneSet.json().phone).toBe("+919876543210");

      const sha = (v: string) => createHash("sha256").update(v).digest("hex");
      const res = await app.inject({
        method: "POST",
        url: "/v1/contacts/match",
        headers: bearer(me.tokens.accessToken),
        payload: { hashes: [sha("bob@example.com"), sha("+919876543210"), sha("asha@example.com"), sha("nobody@example.com")] },
      });
      expect(res.statusCode).toBe(200);
      const matches = res.json().matches as Array<{ hash: string; user: { id: string } }>;
      // Bob matched on both identifiers; the caller's own email and the unknown one are absent.
      expect(matches.map((m) => m.hash).sort()).toEqual([sha("bob@example.com"), sha("+919876543210")].sort());
      expect(matches.every((m) => m.user.id === friend.user.id)).toBe(true);
      expect(JSON.stringify(matches)).not.toContain("bob@example.com");

      const dupPhone = await app.inject({ method: "PATCH", url: "/v1/me", headers: bearer(me.tokens.accessToken), payload: { phone: "+919876543210" } });
      expect(dupPhone.statusCode).toBe(409);

      // Phone numbers are mandatory: they can change but never be removed.
      const cleared = await app.inject({ method: "PATCH", url: "/v1/me", headers: bearer(friend.tokens.accessToken), payload: { phone: "" } });
      expect(cleared.statusCode).toBe(400);
      const changed = await app.inject({ method: "PATCH", url: "/v1/me", headers: bearer(friend.tokens.accessToken), payload: { phone: "+14155550123" } });
      expect(changed.json().phone).toBe("+14155550123");

      // Login and sign-up responses carry the caller's own email and phone.
      const relogin = await login(app, bob.email, bob.password);
      expect(relogin.json().user.email).toBe("bob@example.com");
      expect(relogin.json().user.phone).toBe("+14155550123");

      const bad = await app.inject({ method: "POST", url: "/v1/contacts/match", headers: bearer(me.tokens.accessToken), payload: { hashes: ["not-a-hash"] } });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
      await dbHandle.close();
    }
  });
});

describe("registration policy", () => {
  it("refuses low-assurance providers when the minimum is high", async () => {
    const { app, dbHandle } = await makeApp({ REGISTRATION_MIN_ASSURANCE: "high" });
    try {
      const res = await signupMock(app, { ...asha, email: "low@example.com" });
      expect(res.statusCode).toBe(403);
      const [users] = await dbHandle.db.select({ n: count() }).from(schema.users);
      expect(users!.n).toBe(0);
    } finally {
      await app.close();
      await dbHandle.close();
    }
  });

  it("rolls back the user row when sealing evidence fails", async () => {
    const failingVault: Vault = {
      seal: async () => {
        throw new Error("vault down");
      },
      open: async () => null,
    };
    const { app, dbHandle } = await makeApp({}, failingVault);
    try {
      const res = await signupMock(app, { ...asha, email: "rollback@example.com" });
      expect(res.statusCode).toBe(500);
      const [users] = await dbHandle.db.select({ n: count() }).from(schema.users);
      const [creds] = await dbHandle.db.select({ n: count() }).from(schema.emailCredentials);
      expect(users!.n).toBe(0);
      expect(creds!.n).toBe(0);
    } finally {
      await app.close();
      await dbHandle.close();
    }
  });
});

describe("direct messaging over websocket", () => {
  let app: FastifyInstance;
  let dbHandle: DbHandle;
  let baseUrl: string;
  let alice: IdentityCompleteResponse;
  let bobby: IdentityCompleteResponse;

  beforeAll(async () => {
    ({ app, dbHandle } = await makeApp());
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    alice = (await signupMock(app, { fullName: "Alice", idNumber: "100000000001", email: "alice@example.com", password: "alice-password" })).json();
    bobby = (await signupMock(app, bob)).json();
    for (const [who, username] of [
      [alice, "alice"],
      [bobby, "bob"],
    ] as const) {
      const r = await app.inject({ method: "PATCH", url: "/v1/me", headers: bearer(who.tokens.accessToken), payload: { username } });
      expect(r.statusCode).toBe(200);
    }
  });
  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  function connect() {
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
    const open = new Promise<void>((resolve) => ws.once("open", () => resolve()));
    return { ws, next, nextOfType, send, open, close: () => ws.close() };
  }

  async function directWith(token: string, username: string) {
    const res = await app.inject({ method: "POST", url: "/v1/conversations/direct", headers: bearer(token), payload: { username } });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it("creates one direct conversation per pair", async () => {
    const a = await directWith(alice.tokens.accessToken, "bob");
    const b = await directWith(bobby.tokens.accessToken, "alice");
    expect(b.id).toBe(a.id);
    expect(a.members).toHaveLength(2);
  });

  it("rejects unauthenticated sockets", async () => {
    const c = connect();
    await c.open;
    c.send({ type: "ping" });
    expect((await c.nextOfType("error")).code).toBe("UNAUTHENTICATED");
    c.close();
  });

  it("delivers messages, receipts, typing and presence between two users", async () => {
    const conv = await directWith(alice.tokens.accessToken, "bob");

    const a = connect();
    await a.open;
    a.send({ type: "auth", token: alice.tokens.accessToken });
    expect((await a.nextOfType("ready")).userId).toBe(alice.user.id);

    const b = connect();
    await b.open;
    b.send({ type: "auth", token: bobby.tokens.accessToken });
    expect((await b.nextOfType("ready")).userId).toBe(bobby.user.id);

    expect(await a.nextOfType("presence")).toMatchObject({ userId: bobby.user.id, online: true });
    expect(await b.nextOfType("presence")).toMatchObject({ userId: alice.user.id, online: true });

    a.send({ type: "typing", conversationId: conv.id, isTyping: true });
    expect(await b.nextOfType("typing")).toMatchObject({ userId: alice.user.id, isTyping: true });

    a.send({ type: "message.send", clientId: "c1", conversationId: conv.id, body: "hello bob" });
    const sent = await a.nextOfType("message.sent");
    expect(sent.clientId).toBe("c1");

    const incoming = await b.nextOfType("message.new");
    expect(incoming.message.id).toBe(sent.message.id);

    b.send({ type: "message.ack", messageId: incoming.message.id, kind: "delivered" });
    expect(await a.nextOfType("receipt")).toMatchObject({ messageId: sent.message.id, userId: bobby.user.id, kind: "delivered" });

    b.send({ type: "message.ack", messageId: incoming.message.id, kind: "read" });
    expect(await a.nextOfType("receipt")).toMatchObject({ kind: "read" });

    const bobHistory = await app.inject({ method: "GET", url: `/v1/conversations/${conv.id}/messages`, headers: bearer(bobby.tokens.accessToken) });
    expect(bobHistory.json().messages.map((m: { body: string }) => m.body)).toEqual(["hello bob"]);
    expect(bobHistory.json().messages[0].receipt).toBeUndefined();

    const aliceHistory = await app.inject({ method: "GET", url: `/v1/conversations/${conv.id}/messages`, headers: bearer(alice.tokens.accessToken) });
    expect(aliceHistory.json().messages[0].receipt.deliveredAt).toBeTruthy();
    expect(aliceHistory.json().messages[0].receipt.readAt).toBeTruthy();

    const list = await app.inject({ method: "GET", url: "/v1/conversations", headers: bearer(bobby.tokens.accessToken) });
    expect(list.json().conversations[0].lastMessage.body).toBe("hello bob");
    expect(list.json().conversations[0].unreadCount).toBe(0);

    b.close();
    expect(await a.nextOfType("presence")).toMatchObject({ userId: bobby.user.id, online: false });
    a.close();
  });

  it("blocks non-members from reading a conversation", async () => {
    const carol = (
      await signupMock(app, { fullName: "Carol", idNumber: "100000000003", email: "carol@example.com", password: "carol-password" })
    ).json() as IdentityCompleteResponse;
    const conv = await directWith(alice.tokens.accessToken, "bob");
    const res = await app.inject({ method: "GET", url: `/v1/conversations/${conv.id}/messages`, headers: bearer(carol.tokens.accessToken) });
    expect(res.statusCode).toBe(403);
  });
});
