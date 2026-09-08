import { describe, expect, it } from "vitest";
import { DigiLockerProvider, parseAadhaarXml } from "./digilocker.js";
import { IdentityVerificationError } from "../types.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Certificate>
  <CertificateData>
    <KycRes code="x" ret="Y" ts="2026-09-08T10:00:00" ttl="2026-09-08T10:30:00" txn="t">
      <UidData tkn="abc" uid="XXXXXXXX4321">
        <Poi dob="02-01-1990" gender="F" name="Asha Rao"/>
        <Poa co="" country="India" dist="Pune" state="Maharashtra" pc="411001"/>
        <Pht>/9j/4AAQSkZJRgABAQAAAQABAAD</Pht>
      </UidData>
    </KycRes>
  </CertificateData>
  <Signature>sig</Signature>
</Certificate>`;

function fakeFetch(opts: { eaadhaar: "Y" | "N"; tokenStatus?: number }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith("/public/oauth2/1/token")) {
      if (opts.tokenStatus && opts.tokenStatus !== 200) {
        return new Response("bad", { status: opts.tokenStatus });
      }
      return Response.json({
        access_token: "at",
        token_type: "Bearer",
        expires_in: 3600,
        digilockerid: "dl-user-001",
        name: "Asha Rao",
        dob: "02011990",
        gender: "F",
        eaadhaar: opts.eaadhaar,
        reference_key: "ref-1",
      });
    }
    if (u.endsWith("/public/oauth2/3/xml/eaadhaar")) {
      return new Response(SAMPLE_XML, { status: 200, headers: { "content-type": "application/xml" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

const baseCtx = { sessionId: "sess", state: "state-123", callbackUrl: "https://api.example.com/v1/identity/callback/in.digilocker" };

describe("DigiLockerProvider", () => {
  it("builds a PKCE authorize URL and keeps the verifier secret", async () => {
    const p = new DigiLockerProvider({ clientId: "cid", clientSecret: "sec", fetch: fakeFetch({ eaadhaar: "Y" }).impl });
    const res = await p.start(baseCtx);
    if (res.mode !== "redirect") throw new Error("expected redirect");
    const url = new URL(res.url);
    expect(url.origin + url.pathname).toBe("https://api.digitallocker.gov.in/public/oauth2/1/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(baseCtx.callbackUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(res.secrets?.codeVerifier).toBeTruthy();
    expect(res.url).not.toContain(res.secrets!.codeVerifier!);
  });

  it("exchanges the code, pulls e-KYC and normalises the identity", async () => {
    const ff = fakeFetch({ eaadhaar: "Y" });
    const p = new DigiLockerProvider({ clientId: "cid", clientSecret: "sec", fetch: ff.impl, now: () => new Date("2026-09-08T00:00:00Z") });
    const identity = await p.complete(
      { ...baseCtx, secrets: { codeVerifier: "verifier-xyz" } },
      { code: "auth-code", state: "state-123" },
    );
    expect(identity.provider).toBe("in.digilocker");
    expect(identity.country).toBe("IN");
    expect(identity.assurance).toBe("high");
    expect(identity.subjectId).toBe("dl-user-001");
    expect(identity.maskedId).toBe("4321");
    expect(identity.fullName).toBe("Asha Rao");
    expect(identity.dateOfBirth).toBe("1990-01-02");
    expect(identity.gender).toBe("F");
    expect(identity.photoBase64).toContain("/9j/");
    expect(identity.verifiedAt).toBe("2026-09-08T00:00:00.000Z");

    const tokenCall = ff.calls.find((c) => c.url.endsWith("/token"))!;
    const body = tokenCall.init?.body as URLSearchParams;
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier-xyz");
    expect(body.get("redirect_uri")).toBe(baseCtx.callbackUrl);
    const kycCall = ff.calls.find((c) => c.url.endsWith("/eaadhaar"))!;
    expect((kycCall.init?.headers as Record<string, string>).authorization).toBe("Bearer at");
  });

  it("refuses DigiLocker accounts that are not Aadhaar-verified", async () => {
    const p = new DigiLockerProvider({ clientId: "cid", clientSecret: "sec", fetch: fakeFetch({ eaadhaar: "N" }).impl });
    await expect(
      p.complete({ ...baseCtx, secrets: { codeVerifier: "v" } }, { code: "c", state: "state-123" }),
    ).rejects.toMatchObject({ code: "ID_NOT_LINKED" });
  });

  it("rejects a state mismatch before talking to DigiLocker", async () => {
    const ff = fakeFetch({ eaadhaar: "Y" });
    const p = new DigiLockerProvider({ clientId: "cid", clientSecret: "sec", fetch: ff.impl });
    await expect(
      p.complete({ ...baseCtx, secrets: { codeVerifier: "v" } }, { code: "c", state: "wrong" }),
    ).rejects.toMatchObject({ code: "STATE_MISMATCH" });
    expect(ff.calls).toHaveLength(0);
  });

  it("maps a 401 from the token endpoint to PROVIDER_DENIED", async () => {
    const p = new DigiLockerProvider({ clientId: "cid", clientSecret: "sec", fetch: fakeFetch({ eaadhaar: "Y", tokenStatus: 401 }).impl });
    await expect(
      p.complete({ ...baseCtx, secrets: { codeVerifier: "v" } }, { code: "c", state: "state-123" }),
    ).rejects.toSatisfy((e: unknown) => e instanceof IdentityVerificationError && e.code === "PROVIDER_DENIED");
  });
});

describe("parseAadhaarXml", () => {
  it("extracts masked uid, poi and photo", () => {
    const kyc = parseAadhaarXml(SAMPLE_XML);
    expect(kyc).toEqual({
      maskedUid: "XXXXXXXX4321",
      name: "Asha Rao",
      dob: "02-01-1990",
      gender: "F",
      photoBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD",
    });
  });

  it("throws on XML without UidData", () => {
    expect(() => parseAadhaarXml("<Certificate/>")).toThrow(IdentityVerificationError);
  });
});
