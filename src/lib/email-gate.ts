import { hasVerifiedEmail } from "@/data/users";

import { UserFacingError } from "./errors";
import { freeUseRefusal } from "./limits";

/* The gate on the free allowances: an account spends them only with a
   confirmed email address. The rule is `freeUseRefusal` in limits.ts, pure
   and tested; this is the one place it is joined to Clerk's answer.
   Called from `withModelSpend`, which every free model call already passes
   through, so it is not repeated at each call site. */

/** A refusal whose sentence says what to do. Shown as written. */
export class EmailNotVerifiedError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = "EmailNotVerifiedError";
  }
}

export async function requireVerifiedForFreeUse(user: { id: string }): Promise<void> {
  const refusal = freeUseRefusal(await hasVerifiedEmail(user.id));
  if (refusal) throw new EmailNotVerifiedError(refusal);
}
