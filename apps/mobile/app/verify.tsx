import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { IdentityMethod, IdentityMethodsResponse, IdentityStartResponse, Me } from "@mapp/protocol";
import { ApiError, api, errorMessage } from "../src/api";
import { completeVerification, runRedirectVerification, startVerification } from "../src/identityFlow";
import { routeAfterAuth } from "../src/session";
import { useSignupDraft } from "../src/signupDraft";
import { fonts, radius, spacing } from "../src/theme";
import { AuthScreen, Button, Card, ErrorText, Field, Loading, Muted, Reveal, Steps, Subtitle, TextLink, Title } from "../src/ui";
import { useStyles, useTheme, type Theme } from "../src/useTheme";

const ASSURANCE_LABEL = { high: "Government verified", substantial: "Document verified", low: "Development only" } as const;

type FormSession = { method: IdentityMethod; session: Extract<IdentityStartResponse, { mode: "form" }> };

export default function Verify() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const draft = useSignupDraft((st) => st.draft);
  const [methods, setMethods] = useState<IdentityMethodsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<FormSession | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  function loadMethods() {
    setLoadError(null);
    api<IdentityMethodsResponse>("/v1/identity/methods", { auth: false })
      .then(setMethods)
      .catch((e) => setLoadError(errorMessage(e)));
  }

  useEffect(() => {
    loadMethods();
  }, []);

  if (!draft) return <Redirect href="/signup" />;

  function afterSignIn(user: Me) {
    router.replace(routeAfterAuth(user));
  }

  function showError(e: unknown) {
    setEmailTaken(e instanceof ApiError && e.code === "EMAIL_TAKEN");
    setError(errorMessage(e));
  }

  async function choose(method: IdentityMethod) {
    if (!draft) return;
    setBusy(method.id);
    setError(null);
    setEmailTaken(false);
    try {
      const started = await startVerification(method.id, draft);
      if (started.mode === "form") {
        setForm({ method, session: started });
        setValues({});
        return;
      }
      const outcome = await runRedirectVerification(started.url, started.sessionId);
      if (outcome.kind === "completed") afterSignIn(outcome.result.user);
      else if (outcome.kind === "failed") setError(`Verification failed: ${outcome.code}`);
      else setError("Verification was cancelled.");
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  }

  async function submitForm() {
    if (!form) return;
    setBusy(form.method.id);
    setError(null);
    try {
      const done = await completeVerification(form.session.sessionId, values);
      afterSignIn(done.user);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <AuthScreen>
        <Title>Cannot reach the server</Title>
        <Muted>{loadError}</Muted>
        <Button title="Retry" onPress={loadMethods} variant="secondary" />
      </AuthScreen>
    );
  }

  if (!methods) return <Loading label="Loading identity providers" />;

  const errorBlock = (
    <>
      <ErrorText>{error}</ErrorText>
      {emailTaken ? (
        <Text style={s.hint}>
          <TextLink onPress={() => router.replace("/login")}>Log in instead</TextLink>
        </Text>
      ) : null}
    </>
  );

  if (form) {
    return (
      <AuthScreen>
        <Steps current={2} total={2} label="Verify your identity" />
        <Reveal>
          <Title>{form.method.label}</Title>
          <Subtitle>Enter the details exactly as they appear on your ID.</Subtitle>
        </Reveal>
        <Reveal delay={100}>
          <Card>
            {form.session.fields.map((f) => (
              <Field
                key={f.name}
                label={f.label}
                value={values[f.name] ?? ""}
                onChangeText={(t) => setValues((v) => ({ ...v, [f.name]: t }))}
                keyboardType={f.type === "number" ? "number-pad" : "default"}
                autoCapitalize={f.name === "fullName" ? "words" : "none"}
                icon={f.type === "date" ? "calendar-outline" : f.name === "fullName" ? "person-outline" : "card-outline"}
              />
            ))}
            {errorBlock}
            <Button title="Verify and create account" onPress={() => void submitForm()} busy={busy !== null} icon="checkmark" />
            <Button title="Choose another method" onPress={() => setForm(null)} variant="ghost" disabled={busy !== null} />
          </Card>
        </Reveal>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Steps current={2} total={2} label="Verify your identity" />
      <Reveal>
        <Title>Verify your identity</Title>
        <Subtitle>Signing up as {draft.email}. Pick your country and ID. Your account is created the moment verification succeeds.</Subtitle>
      </Reveal>
      {errorBlock}
      {methods.countries.map((country, i) => (
        <Reveal key={country.code} delay={100 + i * 60}>
          <Card>
            <Text style={s.country}>{country.name}</Text>
            {country.methods.map((m) => (
              <View key={m.id} style={s.method}>
                <View style={s.methodIcon}>
                  <Ionicons name={m.assurance === "high" ? "shield-checkmark" : "shield-half"} size={22} color={colors.primary} />
                </View>
                <View style={s.flex}>
                  <Text style={s.methodLabel}>{m.label}</Text>
                  <Muted>{ASSURANCE_LABEL[m.assurance]}</Muted>
                </View>
                <Button title="Use" compact onPress={() => void choose(m)} busy={busy === m.id} disabled={busy !== null && busy !== m.id} />
              </View>
            ))}
          </Card>
        </Reveal>
      ))}
    </AuthScreen>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    country: { fontFamily: fonts.extrabold, fontSize: 15, color: colors.text, textTransform: "uppercase", letterSpacing: 0.5 },
    method: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    methodIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
    methodLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
    hint: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  });
