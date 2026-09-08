import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import type { AppConfig } from "@mapp/protocol";
import { api, errorMessage } from "../src/api";
import { signup } from "../src/authApi";
import { useSignupDraft } from "../src/signupDraft";
import { fonts } from "../src/theme";
import { AuthScreen, Brand, Button, Card, ErrorText, Field, InfoText, Reveal, Steps, Subtitle, TextLink, Title } from "../src/ui";
import { useStyles, type Theme } from "../src/useTheme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Signup() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const setDraft = useSignupDraft((st) => st.set);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AppConfig>("/v1/config", { auth: false })
      .then(setConfig)
      .catch(() => setConfig({ idVerificationRequired: false }));
  }, []);

  const needsId = config?.idVerificationRequired ?? false;
  const nameError = touched && !needsId && !name.trim() ? "Enter your name" : null;
  const emailError = touched && !EMAIL_RE.test(email.trim()) ? "Enter a valid email address" : null;
  const passwordError = touched && password.length < 8 ? "Use at least 8 characters" : null;
  const confirmError = touched && confirm !== password ? "Passwords do not match" : null;
  const valid = (needsId || name.trim().length > 0) && EMAIL_RE.test(email.trim()) && password.length >= 8 && confirm === password;

  async function next() {
    setTouched(true);
    if (!valid) return;
    const cleanEmail = email.trim().toLowerCase();
    if (needsId) {
      setDraft({ email: cleanEmail, password });
      router.push("/verify");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signup(name.trim(), cleanEmail, password);
      router.replace("/profile");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen
      footer={
        <Text style={s.footer}>
          Already have an account? <TextLink onPress={() => router.replace("/login")}>Log in</TextLink>
        </Text>
      }
    >
      <Brand size={56} horizontal />
      <Reveal>
        <Title>Create your account</Title>
        <Subtitle>{needsId ? "Choose how you will log in, then verify your identity with a national ID." : "Your email and a password are all you need."}</Subtitle>
      </Reveal>
      {needsId ? (
        <Reveal delay={60}>
          <Steps current={1} total={2} label="Login details" />
        </Reveal>
      ) : null}
      <Reveal delay={100}>
        <Card>
          {!needsId ? (
            <Field label="Your name" icon="person-outline" value={name} onChangeText={setName} placeholder="How you appear to others" autoCapitalize="words" error={nameError} />
          ) : null}
          <Field
            label="Email"
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            error={emailError}
          />
          <Field
            label="Password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            error={passwordError}
          />
          <Field
            label="Confirm password"
            icon="lock-closed-outline"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Repeat your password"
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            error={confirmError}
            onSubmitEditing={() => void next()}
          />
          {needsId ? (
            <InfoText icon="shield-checkmark-outline">Your account is only created after your ID is verified. Nothing is saved until then.</InfoText>
          ) : null}
          <ErrorText>{error}</ErrorText>
          <Button
            title={needsId ? "Continue to verification" : "Create account"}
            onPress={() => void next()}
            icon="arrow-forward"
            busy={busy}
            disabled={touched && !valid}
          />
        </Card>
      </Reveal>
    </AuthScreen>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    footer: { fontFamily: fonts.regular, color: colors.muted, fontSize: 14 },
  });
