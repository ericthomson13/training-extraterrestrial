import { addProgramVersion, getProgramOwner } from "../../../_lib/db.js";
import { validateProgram } from "../../../_lib/programValidator.js";

const SUMMARY_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

// 404 (not 403) for "exists but isn't yours" as well as "doesn't exist" --
// an id is an unguessable UUID, but there's no reason to confirm to a
// requester that a given id belongs to someone else.
export async function onRequestPost(context) {
  const programId = context.params.id;
  const owner = await getProgramOwner(context.env.DB, programId);
  if (owner !== context.data.userEmail) {
    return Response.json({ error: "Program not found" }, { status: 404 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const errors = [];
  if (body.changeSummary !== undefined && body.changeSummary !== null) {
    if (typeof body.changeSummary !== "string" || body.changeSummary.length > 500 || SUMMARY_RE.test(body.changeSummary)) {
      errors.push("changeSummary: must be a plain string, max length 500");
    }
  }
  const { errors: contentErrors } = validateProgram(body.content);
  errors.push(...contentErrors);
  if (errors.length > 0) {
    return Response.json({ error: "Invalid program", details: errors }, { status: 422 });
  }

  try {
    const result = await addProgramVersion(context.env.DB, programId, {
      content: body.content,
      changeSummary: body.changeSummary ?? null,
    });
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (e) {
    return Response.json({ error: "Could not add program version" }, { status: 500 });
  }
}
