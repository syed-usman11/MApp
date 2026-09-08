import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Attachment, AttachmentInput, MediaUploadResponse } from "@mapp/protocol";
import { schema, type Db } from "../db/index.js";
import type { AttachmentRecord } from "../db/schema.js";
import { badRequest, forbidden, notFound } from "../errors.js";

export interface MediaServiceOptions {
  /** Base URL the signed links are built on, e.g. https://api.example.com */
  publicUrl: string;
  /** HMAC key for download links. */
  signingSecret: string;
  maxBytes: number;
  /** How long a signed link stays valid. */
  linkTtlSeconds: number;
}

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"]);
const AUDIO_MIMES = new Set(["audio/m4a", "audio/mp4", "audio/aac", "audio/mpeg", "audio/webm", "audio/ogg", "audio/wav", "audio/x-m4a", "audio/3gpp"]);

export function kindOf(mime: string): "image" | "audio" | "file" {
  if (IMAGE_MIMES.has(mime)) return "image";
  if (AUDIO_MIMES.has(mime)) return "audio";
  return "file";
}

/**
 * Stores uploads in Postgres and hands out HMAC-signed download links, so
 * images and audio load in <Image>/<Audio> tags with no auth header. The
 * link embeds the media id and an expiry; the signature covers both.
 */
export class MediaService {
  constructor(
    private readonly db: Db,
    private readonly opts: MediaServiceOptions,
  ) {}

  async upload(ownerId: string, input: { mime: string; name: string; data: Buffer; width?: number; height?: number; durationMs?: number }): Promise<MediaUploadResponse> {
    if (input.data.length === 0) throw badRequest("EMPTY_UPLOAD", "The upload is empty");
    if (input.data.length > this.opts.maxBytes) {
      throw badRequest("TOO_LARGE", `Files are limited to ${Math.round(this.opts.maxBytes / (1024 * 1024))} MB`);
    }
    const mime = input.mime.split(";")[0]!.trim().toLowerCase() || "application/octet-stream";
    const name = input.name.replace(/[\r\n]/g, " ").slice(0, 200) || "file";
    const [row] = await this.db
      .insert(schema.media)
      .values({
        ownerId,
        mime,
        name,
        size: input.data.length,
        width: input.width ?? null,
        height: input.height ?? null,
        durationMs: input.durationMs ?? null,
        data: input.data,
      })
      .returning({ id: schema.media.id });
    const record: AttachmentRecord = {
      mediaId: row!.id,
      mime,
      name,
      size: input.data.length,
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    };
    return this.toAttachment(record);
  }

  /** Confirms an attachment the client wants to send really exists and belongs to them. */
  async assertOwned(ownerId: string, input: AttachmentInput): Promise<AttachmentRecord> {
    const [row] = await this.db.select().from(schema.media).where(eq(schema.media.id, input.mediaId)).limit(1);
    if (!row) throw notFound("Upload");
    if (row.ownerId !== ownerId) throw forbidden("That upload belongs to someone else");
    return {
      mediaId: row.id,
      mime: row.mime,
      name: row.name,
      size: row.size,
      ...(row.width ? { width: row.width } : {}),
      ...(row.height ? { height: row.height } : {}),
      ...(row.durationMs !== null ? { durationMs: row.durationMs } : {}),
    };
  }

  async read(mediaId: string, exp: string, sig: string): Promise<{ mime: string; name: string; data: Buffer }> {
    if (!this.verify(mediaId, exp, sig)) throw forbidden("Invalid or expired link");
    const [row] = await this.db.select().from(schema.media).where(eq(schema.media.id, mediaId)).limit(1);
    if (!row || !row.data) throw notFound("File");
    return { mime: row.mime, name: row.name, data: row.data };
  }

  toAttachment(record: AttachmentRecord): Attachment {
    return { ...record, url: this.signedUrl(record.mediaId) };
  }

  signedUrl(mediaId: string): string {
    const exp = String(Math.floor(Date.now() / 1000) + this.opts.linkTtlSeconds);
    return `${this.opts.publicUrl}/v1/media/${mediaId}?exp=${exp}&sig=${this.sign(mediaId, exp)}`;
  }

  private sign(mediaId: string, exp: string): string {
    return createHmac("sha256", this.opts.signingSecret).update(`${mediaId}:${exp}`).digest("base64url");
  }

  private verify(mediaId: string, exp: string, sig: string): boolean {
    if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(this.sign(mediaId, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
