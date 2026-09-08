import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { errorMessage } from "../src/api";
import { completeVerification } from "../src/identityFlow";
import { routeAfterAuth } from "../src/session";
import { AuthScreen, Button, Loading, Subtitle, Title } from "../src/ui";

// On web the provider popup lands here; this hands the URL back to the opener and closes the popup.
WebBrowser.maybeCompleteAuthSession();

/**
 * Landing route for the server's post-verification redirect. Normally the
 * in-app auth browser intercepts the URL before this renders; this screen is
 * the fallback for cold starts via deep link and for full-page web navigations.
 */
export default function AuthReturn() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string; ticket?: string; error?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = single(params.sessionId);
    const ticket = single(params.ticket);
    const err = single(params.error);
    if (err) {
      setError(`Verification failed: ${err}`);
      return;
    }
    if (!sessionId || !ticket) return;
    completeVerification(sessionId, { ticket })
      .then((done) => router.replace(routeAfterAuth(done.user)))
      .catch((e) => setError(errorMessage(e)));
  }, [params.sessionId, params.ticket, params.error, router]);

  if (error) {
    return (
      <AuthScreen>
        <Title>Could not finish</Title>
        <Subtitle>{error}</Subtitle>
        <Button title="Try again" onPress={() => router.replace("/signup")} />
      </AuthScreen>
    );
  }
  return <Loading label="Finishing verification" />;
}

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
