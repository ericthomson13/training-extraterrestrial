import { getCurrentProgram } from "../../_lib/db.js";

// { program: null } (200, not 404) is the normal "no program yet" state for
// a brand-new user -- not an error. The Getting Started tab (Phase C) is
// what turns this into a real empty-state UI.
export async function onRequestGet(context) {
  const program = await getCurrentProgram(context.env.DB, context.data.userEmail);
  return Response.json({ program });
}
