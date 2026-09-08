import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { backfillEmailHashes } from "./contacts/routes.js";
import { connectDb } from "./db/index.js";
import { AesGcmVault } from "./identity/vault.js";
import { createRegistry } from "./registry.js";

async function main() {
  const config = loadConfig();
  const dbHandle = await connectDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
  const registry = createRegistry(config);
  const vault = config.vaultKeyHex ? AesGcmVault.fromHex(config.vaultKeyHex) : AesGcmVault.deriveFrom(config.identityPepper);

  const app = await buildApp({ config, db: dbHandle.db, registry, vault });

  const backfilled = await backfillEmailHashes(dbHandle.db);
  if (backfilled > 0) app.log.info({ backfilled }, "computed email hashes for existing accounts");

  if (!config.vaultKeyHex) app.log.warn("VAULT_KEY not set; deriving the vault key from IDENTITY_PEPPER (dev only)");
  if (config.registrationMinAssurance !== "high") {
    app.log.warn(`REGISTRATION_MIN_ASSURANCE is "${config.registrationMinAssurance}"; set it to "high" before launch`);
  }
  app.log.info({ providers: registry.list().map((p) => p.id), db: config.databaseUrl ? "postgres" : "pglite" }, "identity providers");

  const shutdown = async () => {
    await app.close();
    await dbHandle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
