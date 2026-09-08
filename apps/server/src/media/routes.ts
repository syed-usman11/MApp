import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authOf, requireAuth } from "../auth/plugin.js";
import type { TokenService } from "../auth/tokens.js";
import { badRequest } from "../errors.js";
import type { MediaService } from "./service.js";

const UploadHeaders = z.object({
  "content-type": z.string().min(1),
  "x-file-name": z.string().max(200).optional(),
  "x-width": z.coerce.number().int().positive().optional(),
  "x-height": z.coerce.number().int().positive().optional(),
  "x-duration-ms": z.coerce.number().int().nonnegative().optional(),
});

const DownloadQuery = z.object({ exp: z.string(), sig: z.string() });

/**
 * Uploads are raw bodies: the file bytes with their real Content-Type and an
 * optional X-File-Name. Simpler for React Native than multipart, and the
 * size limit is enforced by Fastify before the body is buffered.
 */
export function mediaRoutes(app: FastifyInstance, media: MediaService, tokens: TokenService, maxBytes: number) {
  app.post("/v1/media", { preHandler: requireAuth(tokens), bodyLimit: maxBytes + 1024 }, async (req) => {
    const { userId } = authOf(req);
    const h = UploadHeaders.parse(req.headers);
    if (!Buffer.isBuffer(req.body)) throw badRequest("BAD_UPLOAD", "Send the file bytes as the request body");
    const name = h["x-file-name"] ? decodeURIComponent(h["x-file-name"]) : "file";
    return media.upload(userId, {
      mime: h["content-type"],
      name,
      data: req.body,
      width: h["x-width"],
      height: h["x-height"],
      durationMs: h["x-duration-ms"],
    });
  });

  app.get<{ Params: { id: string } }>("/v1/media/:id", async (req, reply) => {
    const q = DownloadQuery.parse(req.query);
    const file = await media.read(req.params.id, q.exp, q.sig);
    const inline = file.mime.startsWith("image/") || file.mime.startsWith("audio/") || file.mime.startsWith("video/");
    return reply
      .header("content-type", file.mime)
      .header("content-length", file.data.length)
      .header("cache-control", "private, max-age=86400")
      .header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
      .send(file.data);
  });
}
