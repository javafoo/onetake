import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL");
  return drizzle(neon(url), { schema });
}

let instance: ReturnType<typeof connect> | undefined;

/** Lazy so importing a module never requires a database (tests, builds). */
export function db() {
  return (instance ??= connect());
}

export { schema };
