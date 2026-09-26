import { activateProgram, getProgramOwner } from "../../../_lib/db.js";

export async function onRequestPost(context) {
  const programId = context.params.id;
  const owner = await getProgramOwner(context.env.DB, programId);
  if (owner !== context.data.userEmail) {
    return Response.json({ error: "Program not found" }, { status: 404 });
  }

  try {
    await activateProgram(context.env.DB, context.data.userEmail, programId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "Could not activate program" }, { status: 500 });
  }
}
