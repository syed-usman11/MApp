import type { IdentityMethodsResponse } from "@mapp/protocol";
import type { NationalIdProvider } from "./types.js";

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India",
  SG: "Singapore",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  BE: "Belgium",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  NL: "Netherlands",
  EE: "Estonia",
  UA: "Ukraine",
  HK: "Hong Kong",
  TH: "Thailand",
  BR: "Brazil",
  /** ISO user-assigned code, reserved here for the development mock. */
  ZZ: "Development",
};

/**
 * Holds every enabled provider and answers "which methods can a user in
 * country X use?". Order of registration is the order shown to the user.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, NationalIdProvider>();

  register(provider: NationalIdProvider): this {
    if (this.providers.has(provider.id)) {
      throw new Error(`Identity provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  get(id: string): NationalIdProvider | undefined {
    return this.providers.get(id);
  }

  list(): NationalIdProvider[] {
    return [...this.providers.values()];
  }

  /** Grouped view for the client's country picker. */
  methodsByCountry(): IdentityMethodsResponse {
    const byCountry = new Map<string, NationalIdProvider[]>();
    for (const p of this.providers.values()) {
      const arr = byCountry.get(p.country) ?? [];
      arr.push(p);
      byCountry.set(p.country, arr);
    }
    return {
      countries: [...byCountry.entries()].map(([code, providers]) => ({
        code,
        name: COUNTRY_NAMES[code] ?? code,
        methods: providers.map((p) => ({
          id: p.id,
          country: p.country,
          label: p.label,
          assurance: p.assurance,
        })),
      })),
    };
  }
}
