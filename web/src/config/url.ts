import { env } from "~/env.js";

export const ORIGIN_URL: string =
  env.NEXT_PUBLIC_BASE_URL || env.BETTER_AUTH_URL || "http://localhost:3000";
