import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import type { Attachment, MediaUploadResponse } from "@mapp/protocol";
import { ApiError, ensureFreshAccessToken, fetchWithTimeout } from "./api";
import { API_URL } from "./config";

export interface LocalFile {
  uri: string;
  mime: string;
  name: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Opens the photo library for a photo or a video. Resolves null when the user cancels. */
export async function pickMedia(kinds: Array<"images" | "videos"> = ["images", "videos"]): Promise<LocalFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Photo access was not allowed");
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: kinds, quality: 0.85, exif: false, videoMaxDuration: 180 });
  if (res.canceled || !res.assets[0]) return null;
  return fromImageAsset(res.assets[0]);
}

/** Photos only; used for group avatars. */
export function pickImage(): Promise<LocalFile | null> {
  return pickMedia(["images"]);
}

/** Opens the camera. Not available on web. */
export async function takePhoto(): Promise<LocalFile | null> {
  if (Platform.OS === "web") return pickImage();
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("Camera access was not allowed");
  const res = await ImagePicker.launchCameraAsync({ quality: 0.85, exif: false });
  if (res.canceled || !res.assets[0]) return null;
  return fromImageAsset(res.assets[0]);
}

function fromImageAsset(a: ImagePicker.ImagePickerAsset): LocalFile {
  const isVideo = a.type === "video" || (a.mimeType ?? "").startsWith("video/");
  const mime = a.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg");
  const ext = mime.split("/")[1] ?? (isVideo ? "mp4" : "jpg");
  return {
    uri: a.uri,
    mime,
    name: a.fileName ?? `${isVideo ? "video" : "photo"}-${Date.now()}.${ext}`,
    size: a.fileSize ?? undefined,
    width: a.width,
    height: a.height,
    ...(isVideo && a.duration ? { durationMs: Math.round(a.duration) } : {}),
  };
}

export type MediaKind = "image" | "video" | "audio" | "file";

export function kindOfMime(mime: string): MediaKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

/**
 * Saves a photo or video to the device gallery (asks for the storage
 * permission first), or triggers a browser download on the web.
 */
export async function saveToDevice(attachment: Attachment): Promise<void> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(attachment.url)).blob();
    const doc = globalThis.document;
    const objectUrl = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = objectUrl;
    a.download = attachment.name;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return;
  }
  // Loaded lazily: the module has no web implementation and throws at import time there.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const MediaLibrary = require("expo-media-library") as typeof import("expo-media-library");
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) throw new Error("Storage permission was not allowed. Enable it in Settings to save media.");
  const dir = new Directory(Paths.cache, "downloads");
  dir.create({ intermediates: true, idempotent: true });
  const safeName = attachment.name.replace(/[^\w.\-]+/g, "_") || `media-${Date.now()}`;
  const target = new File(dir, `${Date.now()}-${safeName}`);
  const file = await File.downloadFileAsync(attachment.url, target);
  await MediaLibrary.saveToLibraryAsync(file.uri);
}

/** Opens the system file picker. Resolves null when the user cancels. */
export async function pickDocument(): Promise<LocalFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, mime: a.mimeType ?? "application/octet-stream", name: a.name, size: a.size ?? undefined };
}

/**
 * Sends the file bytes to the API as a raw body. Works for picker URIs on
 * native (file://) and for blob:/data: URLs on web.
 */
export async function uploadFile(file: LocalFile): Promise<MediaUploadResponse> {
  if (file.size && file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "TOO_LARGE", "Files are limited to 10 MB");
  const blob = await (await fetch(file.uri)).blob();
  if (blob.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "TOO_LARGE", "Files are limited to 10 MB");
  const token = await ensureFreshAccessToken();
  if (!token) throw new ApiError(401, "UNAUTHENTICATED", "Sign in again");
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": file.mime || blob.type || "application/octet-stream",
    "x-file-name": encodeURIComponent(file.name),
  };
  if (file.width) headers["x-width"] = String(file.width);
  if (file.height) headers["x-height"] = String(file.height);
  if (file.durationMs !== undefined) headers["x-duration-ms"] = String(Math.round(file.durationMs));
  const res = await fetchWithTimeout(`${API_URL}/v1/media`, { method: "POST", headers, body: blob });
  if (!res.ok) {
    let message = "Upload failed";
    let code = `HTTP_${res.status}`;
    try {
      const json = (await res.json()) as { error?: { code?: string; message?: string } };
      message = json.error?.message ?? message;
      code = json.error?.code ?? code;
    } catch {
      // non-JSON body
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as MediaUploadResponse;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
