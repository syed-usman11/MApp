import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import type { DeviceInfo, IdentityCompleteResponse, IdentityStartResponse, SignupCredentials } from "@mapp/protocol";
import { api } from "./api";
import { useSession } from "./session";
import { useSignupDraft } from "./signupDraft";

export function deviceInfo(): DeviceInfo {
  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  return { platform, name: (Constants.deviceName ?? Platform.OS).slice(0, 80) };
}

/** Where a redirect-mode provider should send the user back. Resolves per runtime (dev client, Expo Go, web). */
export function returnUrl(): string {
  return Linking.createURL("auth");
}

export async function startVerification(method: string, signup: SignupCredentials): Promise<IdentityStartResponse> {
  return api<IdentityStartResponse>("/v1/identity/start", {
    auth: false,
    body: { method, device: deviceInfo(), signup, returnUrl: returnUrl() },
  });
}

/** Finishes a session and signs the user in. Works for both form and ticket inputs. */
export async function completeVerification(sessionId: string, input: Record<string, unknown>): Promise<IdentityCompleteResponse> {
  const done = await api<IdentityCompleteResponse>("/v1/identity/complete", { auth: false, body: { sessionId, input } });
  useSignupDraft.getState().clear();
  await useSession.getState().signIn(done.user, done.tokens);
  return done;
}

export type RedirectOutcome =
  | { kind: "completed"; result: IdentityCompleteResponse }
  | { kind: "cancelled" }
  | { kind: "failed"; code: string };

/** Opens the provider in a secure in-app browser and waits for the app's own return URL. */
export async function runRedirectVerification(url: string, sessionId: string): Promise<RedirectOutcome> {
  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl());
  if (result.type !== "success") return { kind: "cancelled" };
  const { queryParams } = Linking.parse(result.url);
  const error = queryParams?.error;
  if (typeof error === "string" && error) return { kind: "failed", code: error };
  const ticket = queryParams?.ticket;
  if (typeof ticket !== "string" || !ticket) return { kind: "failed", code: "MISSING_TICKET" };
  const sid = typeof queryParams?.sessionId === "string" ? queryParams.sessionId : sessionId;
  return { kind: "completed", result: await completeVerification(sid, { ticket }) };
}
