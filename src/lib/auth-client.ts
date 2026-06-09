import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

// No baseURL: resolve to same-origin so auth works on whatever host serves the
// page — production (prntd.org), a *.vercel.app preview, or preview.prntd.org.
// Hardcoding the prod URL here made preview deploys fire cross-origin auth
// requests at prntd.org, which CORS rejected.
export const authClient = createAuthClient({
  plugins: [anonymousClient()],
});
