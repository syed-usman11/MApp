import { z } from "zod";

export const Id = z.string().uuid();
export type Id = z.infer<typeof Id>;

export const Platform = z.enum(["ios", "android", "web"]);
export type Platform = z.infer<typeof Platform>;

export const DeviceInfo = z.object({
  platform: Platform,
  name: z.string().min(1).max(80),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const PublicUser = z.object({
  id: Id,
  displayName: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  /** ISO country of the national ID that verified this account. */
  verifiedCountry: z.string().length(2).nullable(),
});
export type PublicUser = z.infer<typeof PublicUser>;

/** E.164: a plus sign followed by 7 to 15 digits. */
export const PhoneE164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +919876543210");

/**
 * The signed-in user's own view: public profile plus private email and phone.
 * Login and sign-up return this shape; other users only ever see PublicUser.
 * A profile is complete once both username and phone are set.
 */
export const Me = PublicUser.extend({
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Me = z.infer<typeof Me>;

export function isProfileComplete(user: Pick<Me, "username" | "phone">): boolean {
  return !!user.username && !!user.phone;
}

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
