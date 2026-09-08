import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock.js";
import { IdentityVerificationError } from "../types.js";

const ctx = { sessionId: "s", state: "st", callbackUrl: "http://x/cb", secrets: {} };

describe("MockProvider", () => {
  it("offers a form", async () => {
    const res = await new MockProvider().start(ctx);
    expect(res.mode).toBe("form");
  });

  it("maps the same id number to the same subject without keeping the number", async () => {
    const p = new MockProvider();
    const a = await p.complete(ctx, { fullName: "Asha Rao", dateOfBirth: "1990-01-02", idNumber: "123456789012" });
    const b = await p.complete(ctx, { fullName: "Asha Rao", dateOfBirth: "1990-01-02", idNumber: "123456789012" });
    expect(a.subjectId).toBe(b.subjectId);
    expect(a.subjectId).not.toContain("123456789012");
    expect(a.maskedId).toBe("9012");
    expect(a.assurance).toBe("low");
  });

  it("rejects bad input", async () => {
    await expect(new MockProvider().complete(ctx, { fullName: "A", dateOfBirth: "x", idNumber: "1" })).rejects.toBeInstanceOf(
      IdentityVerificationError,
    );
  });
});
