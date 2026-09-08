import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { errorMessage } from "../src/api";
import { login } from "../src/authApi";
import { routeAfterAuth } from "../src/session";
import { fonts } from "../src/theme";
import { AuthScreen, Brand, Button, Card, ErrorText, Field, Reveal, Subtitle, TextLink, Title } from "../src/ui";
import { useStyles, type Theme } from "../src/useTheme";

export default function Login() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password);
      router.replace(routeAfterAuth(res.user));
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
          New here? <TextLink onPress={() => router.replace("/signup")}>Create an account</TextLink>
        </Text>
      }
    >
      <Brand size={56} horizontal />
      <Reveal>
        <Title>Welcome back</Title>
        <Subtitle>Log in with the email and password you chose when you signed up.</Subtitle>
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
          />
          <Field
            label="Password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
            textContentType="password"
            autoComplete="password"
            onSubmitEditing={() => void submit()}
          />
          <View style={s.forgotRow}>
            <TextLink onPress={() => router.push("/forgot")}>Forgot password?</TextLink>
          </View>
          <ErrorText>{error}</ErrorText>
          <Button title="Log in" onPress={() => void submit()} busy={busy} disabled={!email.trim() || !password} />
        </Card>
      </Reveal>
    </AuthScreen>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    forgotRow: { alignItems: "flex-end" },
    footer: { fontFamily: fonts.regular, color: colors.muted, fontSize: 14 },
  });
