import { deleteSession } from "../../_lib/db.js";

export async function onRequestDelete(context) {
  await deleteSession(context.env.DB, context.data.userEmail, context.params.id);
  return Response.json({ ok: true });
}
