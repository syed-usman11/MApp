import { Redirect } from "expo-router";
import { routeAfterAuth, useSession } from "../src/session";
import { Loading } from "../src/ui";

export default function Index() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);

  if (status === "loading") return <Loading />;
  if (status === "signedOut" || !user) return <Redirect href="/welcome" />;
  return <Redirect href={routeAfterAuth(user)} />;
}
