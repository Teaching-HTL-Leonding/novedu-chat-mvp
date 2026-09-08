import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth";

// better-auth owns every `/api/auth/*` sub-route: the Entra sign-in redirect and
// callback, `get-session`, `sign-out`, and the device-authorization endpoints the
// CLI polls. The catch-all segment hands the whole prefix to the one handler.
export const { GET, POST } = toNextJsHandler(auth);
