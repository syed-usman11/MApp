import { DigiLockerProvider, MockProvider, ProviderRegistry } from "@mapp/identity";
import type { Config } from "./config.js";

export function createRegistry(config: Config, log: { warn(msg: string): void } = console): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const id of config.identityProviders) {
    switch (id) {
      case "mock":
        if (config.nodeEnv === "production") {
          throw new Error("The mock identity provider must not be enabled in production");
        }
        registry.register(new MockProvider());
        break;
      case "in.digilocker": {
        const { clientId, clientSecret, baseUrl } = config.digilocker;
        if (!clientId || !clientSecret) {
          log.warn("in.digilocker listed in IDENTITY_PROVIDERS but DIGILOCKER_CLIENT_ID/SECRET are missing; skipping");
          break;
        }
        registry.register(new DigiLockerProvider({ clientId, clientSecret, baseUrl }));
        break;
      }
      default:
        throw new Error(`Unknown identity provider "${id}"`);
    }
  }
  if (registry.list().length === 0) {
    if (config.idVerificationRequired) {
      throw new Error("No identity providers are enabled while ID_VERIFICATION_REQUIRED=true; registration would be impossible");
    }
    log.warn("No identity providers are enabled; only email/password sign-up is available");
  }
  return registry;
}
