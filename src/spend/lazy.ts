import type { LimitedUser } from "@/lib/rate-limit";

import type { SpendOptions } from "./index";

/* `withModelSpend`, reached without importing it. The spend module is
   server-only, so a shared function that imports it at the top cannot be
   loaded by a unit test; one that takes a `Spend` and defaults to this one can
   be handed a pass-through instead. */

export type Spend = <T>(user: LimitedUser, options: SpendOptions, fn: () => Promise<T>) => Promise<T>;

export const lazySpend: Spend = async (user, options, fn) => (await import("./index")).withModelSpend(user, options, fn);
