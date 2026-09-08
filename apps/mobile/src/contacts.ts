import * as Contacts from "expo-contacts";
import * as Crypto from "expo-crypto";
import { getLocales } from "expo-localization";
// The "core" build takes metadata explicitly, which sidesteps Metro's trouble with the ".json.js" file the "min" build imports.
import { parsePhoneNumberFromString, type CountryCode, type MetadataJson } from "libphonenumber-js/core";
import phoneMetadata from "libphonenumber-js/metadata.min.json";
import { Platform } from "react-native";
import { create } from "zustand";
import { normalizeEmailForHash, normalizePhoneForHash, type ContactsMatchResponse, type PublicUser } from "@mapp/protocol";
import { api, errorMessage } from "./api";

export interface DeviceContact {
  id: string;
  name: string;
  /** E.164 numbers only; anything unparseable is dropped. */
  phones: string[];
  emails: string[];
}

export interface MatchedContact {
  contact: DeviceContact;
  user: PublicUser;
}

export type ContactsStatus = "unavailable" | "undetermined" | "denied" | "granted";

/** ISO region used to interpret local-format numbers in the address book. */
export function defaultRegion(): CountryCode {
  const region = getLocales()[0]?.regionCode;
  return (region && region.length === 2 ? region.toUpperCase() : "IN") as CountryCode;
}

/** "98765 43210" with region IN becomes "+919876543210"; invalid input becomes null. */
export function toE164(raw: string, region: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(raw, region, phoneMetadata as MetadataJson);
  return parsed?.isValid() ? parsed.number : null;
}

async function sha256(value: string): Promise<string> {
  return (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value)).toLowerCase();
}

const uniq = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => !!v))];

async function readAddressBook(region: CountryCode): Promise<DeviceContact[]> {
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.FirstName, Contacts.Fields.LastName, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
  });
  return data
    .map((c, index) => ({
      id: c.id ?? `local-${index}`,
      name: c.name?.trim() || [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Unknown",
      phones: uniq((c.phoneNumbers ?? []).map((p) => (p.number ? toE164(p.number, region) : null))),
      emails: uniq((c.emails ?? []).map((e) => e.email?.trim().toLowerCase())),
    }))
    .filter((c) => c.phones.length > 0 || c.emails.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Hash every identifier, ask the server which ones are registered, and split the address book accordingly. */
async function matchAgainstServer(contacts: DeviceContact[]): Promise<{ registered: MatchedContact[]; unregistered: DeviceContact[] }> {
  const hashToContact = new Map<string, DeviceContact>();
  for (const contact of contacts) {
    for (const phone of contact.phones) hashToContact.set(await sha256(normalizePhoneForHash(phone)), contact);
    for (const email of contact.emails) hashToContact.set(await sha256(normalizeEmailForHash(email)), contact);
  }
  const hashes = [...hashToContact.keys()];
  const matches: ContactsMatchResponse["matches"] = [];
  for (let i = 0; i < hashes.length; i += 500) {
    const res = await api<ContactsMatchResponse>("/v1/contacts/match", { body: { hashes: hashes.slice(i, i + 500) } });
    matches.push(...res.matches);
  }

  const registered: MatchedContact[] = [];
  const seenUsers = new Set<string>();
  const matchedContactIds = new Set<string>();
  for (const m of matches) {
    const contact = hashToContact.get(m.hash);
    if (!contact || seenUsers.has(m.user.id)) continue;
    seenUsers.add(m.user.id);
    matchedContactIds.add(contact.id);
    registered.push({ contact, user: m.user });
  }
  registered.sort((a, b) => a.contact.name.localeCompare(b.contact.name));
  const unregistered = contacts.filter((c) => !matchedContactIds.has(c.id));
  return { registered, unregistered };
}

interface ContactsState {
  status: ContactsStatus;
  loading: boolean;
  error: string | null;
  registered: MatchedContact[];
  unregistered: DeviceContact[];
  syncedAt: number | null;
  checkPermission(): Promise<void>;
  requestAndSync(): Promise<void>;
  sync(): Promise<void>;
}

export const useContacts = create<ContactsState>((set, get) => ({
  status: Platform.OS === "web" ? "unavailable" : "undetermined",
  loading: false,
  error: null,
  registered: [],
  unregistered: [],
  syncedAt: null,

  async checkPermission() {
    if (Platform.OS === "web") return;
    try {
      const { status } = await Contacts.getPermissionsAsync();
      set({ status: status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined" });
      if (status === "granted" && get().syncedAt === null) await get().sync();
    } catch {
      set({ status: "unavailable" });
    }
  },

  async requestAndSync() {
    if (Platform.OS === "web") return;
    const { status } = await Contacts.requestPermissionsAsync();
    set({ status: status === "granted" ? "granted" : "denied" });
    if (status === "granted") await get().sync();
  },

  async sync() {
    set({ loading: true, error: null });
    try {
      const contacts = await readAddressBook(defaultRegion());
      const { registered, unregistered } = await matchAgainstServer(contacts);
      set({ registered, unregistered, syncedAt: Date.now(), loading: false });
    } catch (e) {
      set({ error: errorMessage(e), loading: false });
    }
  },
}));
