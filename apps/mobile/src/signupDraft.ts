import { create } from "zustand";

/**
 * Credentials chosen on the sign-up screen, held in memory only until the
 * national-ID step completes. Never persisted and never put in a URL.
 */
interface SignupDraftState {
  draft: { email: string; password: string } | null;
  set(draft: { email: string; password: string }): void;
  clear(): void;
}

export const useSignupDraft = create<SignupDraftState>((set) => ({
  draft: null,
  set: (draft) => set({ draft }),
  clear: () => set({ draft: null }),
}));
