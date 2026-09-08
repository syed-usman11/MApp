import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { unauthenticated } from "../errors.js";

export interface AuthContext {
  userId: string;
  deviceId: string;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async signAccess(ctx: AuthContext): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const token = await new SignJWT({ dev: ctx.deviceId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(ctx.userId)
      .setIssuer("mapp")
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  async verifyAccess(token: string): Promise<AuthContext> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: "mapp", algorithms: ["HS256"] });
      if (!payload.sub || typeof payload.dev !== "string") throw new Error("malformed");
      return { userId: payload.sub, deviceId: payload.dev };
    } catch {
      throw unauthenticated("Invalid or expired access token");
    }
  }

  /** Opaque long-lived device credential. Only its hash is stored. */
  static newDeviceToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: TokenService.hash(token) };
  }

  static hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
