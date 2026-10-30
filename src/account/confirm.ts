/* The words somebody has to type to delete their account.
 *
 * Here, rather than in the action, because a "use server" module may only
 * export async functions: a constant beside them turns the whole file into a
 * build error. Both the form and the action read it from one place, so what
 * the label asks for and what the server accepts cannot drift apart.
 */
export const CONFIRMATION = "delete my account";
