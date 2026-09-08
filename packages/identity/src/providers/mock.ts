import { createHash } from "node:crypto";
import { z } from "zod";
import {
  IdentityVerificationError,
  normaliseDate,
  type CompleteContext,
  type NationalIdProvider,
  type StartContext,
  type StartResult,
  type VerifiedIdentity,
} from "../types.js";

const MockInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: z.string().trim().min(8),
  idNumber: z.string().trim().regex(/^\d{12}$/, "12 digits"),
});

/**
 * Self-asserted identity for local development and automated tests.
 * Assurance is "low"; production registration policy must reject it.
 */
export class MockProvider implements NationalIdProvider {
  readonly id = "mock";
  readonly country = "ZZ";
  readonly label = "Mock ID (development only)";
  readonly assurance = "low" as const;

  async start(_ctx: StartContext): Promise<StartResult> {
    return {
      mode: "form",
      fields: [
        { name: "fullName", label: "Full name", type: "text", required: true },
        { name: "dateOfBirth", label: "Date of birth (YYYY-MM-DD)", type: "date", required: true },
        { name: "idNumber", label: "ID number (any 12 digits)", type: "text", required: true },
      ],
    };
  }

  async complete(_ctx: CompleteContext, input: Record<string, unknown>): Promise<VerifiedIdentity> {
    const parsed = MockInput.safeParse(input);
    if (!parsed.success) {
      throw new IdentityVerificationError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { fullName, dateOfBirth, idNumber } = parsed.data;
    const dob = normaliseDate(dateOfBirth);
    if (!dob) throw new IdentityVerificationError("INVALID_INPUT", "Date of birth must be YYYY-MM-DD");

    return {
      provider: this.id,
      country: this.country,
      assurance: this.assurance,
      // Never keep the raw number, even in the mock: hash it like a real scheme would.
      subjectId: createHash("sha256").update(idNumber).digest("hex"),
      maskedId: idNumber.slice(-4),
      fullName,
      dateOfBirth: dob,
      gender: null,
      photoBase64: null,
      evidence: { source: "mock" },
      verifiedAt: new Date().toISOString(),
    };
  }
}
