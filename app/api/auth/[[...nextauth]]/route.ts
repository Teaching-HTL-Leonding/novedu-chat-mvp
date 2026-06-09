import { handlers } from "@/auth";

// Auth.js sign-in / callback / sign-out endpoints. The catch-all path lets
// Auth.js own every `/api/auth/*` sub-route.
export const { GET, POST } = handlers;
