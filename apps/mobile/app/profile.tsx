import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";
import { isProfileComplete, type Me } from "@mapp/protocol";
import { api, errorMessage } from "../src/api";
import { defaultRegion, toE164 } from "../src/contacts";
import { useSession } from "../src/session";
import { spacing } from "../src/theme";
import { AuthScreen, Avatar, Button, Card, ErrorText, Field, InfoText, Reveal, Subtitle, Title } from "../src/ui";

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export default function Profile() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const firstRun = !user || !isProfileComplete(user);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cleanUsername = username.trim().toLowerCase();
  const phoneE164 = phone.trim() ? toE164(phone, defaultRegion()) : null;
  const nameError = touched && !displayName.trim() ? "Enter your name" : null;
  const usernameError = touched && !USERNAME_RE.test(cleanUsername) ? "3 to 30 characters: lowercase letters, digits, underscore" : null;
  const phoneError = touched && !phoneE164 ? (phone.trim() ? "Enter a valid number with the country code, e.g. +91 98765 43210" : "Phone number is required") : null;
  const valid = displayName.trim().length > 0 && USERNAME_RE.test(cleanUsername) && !!phoneE164;

  async function save() {
    setTouched(true);
    if (!valid || !phoneE164) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Me>("/v1/me", {
        method: "PATCH",
        body: { displayName: displayName.trim(), username: cleanUsername, phone: phoneE164 },
      });
      await setUser(updated);
      if (!firstRun && router.canGoBack()) router.back();
      else router.replace("/chats");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen>
      <Reveal style={styles.hero}>
        <Avatar name={displayName || user?.displayName || "?"} size={88} />
        <Title center>{firstRun ? "Set up your profile" : "Edit profile"}</Title>
        <Subtitle center>Your username is how people find you. Your phone lets contacts recognise you. Both stay private otherwise.</Subtitle>
      </Reveal>
      <Reveal delay={100}>
        <Card>
          {user?.verifiedCountry ? <InfoText icon="shield-checkmark-outline">{`Identity verified · ${user.verifiedCountry}`}</InfoText> : null}
          <Field label="Display name" icon="person-outline" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" error={nameError} />
          <Field
            label="Username"
            icon="at-outline"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="lowercase, digits, underscore"
            error={usernameError}
          />
          <Field
            label="Phone number"
            icon="call-outline"
            value={phone}
            onChangeText={setPhone}
            placeholder="+91 98765 43210"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            error={phoneError}
            onSubmitEditing={() => void save()}
          />
          <InfoText icon="people-outline">Contacts who have your number will see you are on MApp. Only a scrambled version of the number is ever compared.</InfoText>
          <ErrorText>{error}</ErrorText>
          <Button
            title={firstRun ? "Continue" : "Save"}
            icon={firstRun ? "arrow-forward" : "checkmark"}
            onPress={() => void save()}
            busy={busy}
            disabled={touched && !valid}
          />
        </Card>
      </Reveal>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: spacing.md, marginTop: spacing.md },
});
