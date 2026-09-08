import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Seals provider evidence before it touches the database. AES-256-GCM with a
 * key that never lives in the database. Layout: iv(12) | tag(16) | ciphertext.
 * Production should back this with a KMS-managed key per data-residency region.
 */
export interface Vault {
  seal(value: unknown): Promise<Buffer>;
  open(sealed: Buffer): Promise<unknown>;
}

export class AesGcmVault implements Vault {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error("Vault key must be 32 bytes");
    this.key = key;
  }

  static fromHex(hex: string): AesGcmVault {
    return new AesGcmVault(Buffer.from(hex, "hex"));
  }

  /** Dev-only convenience: derive a key from another secret so no extra env var is needed. */
  static deriveFrom(secret: string): AesGcmVault {
    return new AesGcmVault(createHash("sha256").update(`vault:${secret}`).digest());
  }

  async seal(value: unknown): Promise<Buffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value ?? null), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  async open(sealed: Buffer): Promise<unknown> {
    const iv = sealed.subarray(0, 12);
    const tag = sealed.subarray(12, 28);
    const ciphertext = sealed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  }
}
