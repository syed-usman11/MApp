import type { AuthResponse, ForgotPasswordResponse, IdentityCompleteResponse } from "@mapp/protocol";
import { api } from "./api";
import { deviceInfo } from "./identityFlow";
import { useSession } from "./session";

/** Direct account creation; only available while the server has ID verification switched off. */
export async function signup(displayName: string, email: string, password: string): Promise<IdentityCompleteResponse> {
  const res = await api<IdentityCompleteResponse>("/v1/auth/signup", {
    auth: false,
    body: { displayName, email, password, device: deviceInfo() },
  });
  await useSession.getState().signIn(res.user, res.tokens);
  return res;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await api<AuthResponse>("/v1/auth/login", { auth: false, body: { email, password, device: deviceInfo() } });
  await useSession.getState().signIn(res.user, res.tokens);
  return res;
}

export function forgotPassword(email: string): Promise<ForgotPasswordResponse> {
  return api<ForgotPasswordResponse>("/v1/auth/forgot", { auth: false, body: { email } });
}

export function resetPassword(email: string, code: string, newPassword: string): Promise<{ ok: true }> {
  return api<{ ok: true }>("/v1/auth/reset", { auth: false, body: { email, code, newPassword } });
}

/** Revokes this device on the server, then clears the local session either way. */
export async function logout(): Promise<void> {
  try {
    await api<{ ok: true }>("/v1/auth/logout", { method: "POST", body: {} });
  } catch {
    // Offline or already revoked: still sign out locally.
  }
  await useSession.getState().signOut();
}
