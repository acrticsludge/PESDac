import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.PUBLIC_BETTER_AUTH_URL,
  // Mirrors the server's twoFactor() plugin — without this the client
  // has no authClient.twoFactor.* methods and 2FA users hit a dead end.
  plugins: [twoFactorClient()],
});