import { auth } from "@clerk/nextjs/server";

import { spendableBalance } from "@/billing/credits";

/* The signed-in user's credit balance, for anything that needs to show it
   changing without a page reload. The balance is the sum of that user's ledger
   rows and is never read for anybody else. */

export const maxDuration = 15;
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Not signed in" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  return new Response(JSON.stringify({ balance: await spendableBalance(userId) }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
