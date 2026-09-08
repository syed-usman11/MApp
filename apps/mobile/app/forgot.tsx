import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { errorMessage } from "../src/api";
import { forgotPassword, resetPassword } from "../src/authApi";
import { fonts } from "../src/theme";
import { AuthScreen, Brand, Button, Card, ErrorText, Field, InfoText, Reveal, Subtitle, TextLink, Title } from "../src/ui";
import { useStyles, type Theme } from "../src/useTheme";

export default function Forgot() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const [step, setStep] = useState<"request" | "reset" | "done">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await forgotPassword(email.trim());
      setDevCode(res.devCode ?? null);
      setStep("reset");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim(), code.trim(), password);
      setStep("done");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <Text style={s.footer}>
      Remembered it? <TextLink onPress={() => router.replace("/login")}>Back to log in</TextLink>
    </Text>
  );

  if (step === "done") {
    return (
      <AuthScreen>
        <Brand size={56} horizontal />
        <Reveal>
          <Title>Password updated</Title>
          <Subtitle>You have been signed out everywhere. Log in with your new password to continue.</Subtitle>
        </Reveal>
        <Reveal delay={100}>
          <Button title="Go to log in" onPress={() => router.replace("/login")} icon="arrow-forward" />
        </Reveal>
      </AuthScreen>
    );
  }

  if (step === "reset") {
    return (
      <AuthScreen footer={footer}>
        <Brand size={56} horizontal />
        <Reveal>
          <Title>Check your email</Title>
          <Subtitle>If {email.trim()} has an account, we sent it a 6-digit code. Enter it below with your new password.</Subtitle>
        </Reveal>
        <Reveal delay={100}>
          <Card>
            {devCode ? <InfoText icon="construct-outline">{`Development server: your code is ${devCode}. Real deployments email it instead.`}</InfoText> : null}
            <Field
              label="6-digit code"
              icon="key-outline"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
            />
            <Field
              label="New password"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
            />
            <Field
              label="Confirm new password"
              icon="lock-closed-outline"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat your new password"
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              onSubmitEditing={() => void reset()}
            />
            <ErrorText>{error}</ErrorText>
            <Button title="Set new password" onPress={() => void reset()} busy={busy} disabled={code.trim().length !== 6 || password.length < 8} />
            <Button title="Send a new code" variant="ghost" onPress={() => void request()} disabled={busy} />
          </Card>
        </Reveal>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen footer={footer}>
      <Brand size={56} horizontal />
      <Reveal>
        <Title>Forgot your password?</Title>
        <Subtitle>Enter the email you signed up with and we will send you a code to set a new one.</Subtitle>
      </Reveal>
      <Reveal delay={100}>
        <Card>
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
            onSubmitEditing={() => void request()}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Send reset code" onPress={() => void request()} busy={busy} disabled={!email.trim()} icon="send-outline" />
        </Card>
      </Reveal>
    </AuthScreen>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    footer: { fontFamily: fonts.regular, color: colors.muted, fontSize: 14 },
  });
