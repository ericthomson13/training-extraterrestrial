import { createProgram, listPrograms } from "../../_lib/db.js";
import { validateProgram } from "../../_lib/programValidator.js";

const NAME_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function checkMeta(body) {
  const errors = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return ["Request body must be a JSON object"];
  }
  if (typeof body.name !== "string" || body.name.length === 0) {
    errors.push("name: must be a non-empty string");
  } else if (body.name.length > 200) {
    errors.push("name: exceeds max length of 200");
  } else if (NAME_RE.test(body.name)) {
    errors.push("name: contains disallowed control characters");
  }
  if (body.sport !== undefined && body.sport !== null) {
    if (typeof body.sport !== "string" || body.sport.length > 100 || NAME_RE.test(body.sport)) {
      errors.push("sport: must be a plain string, max length 100");
    }
  }
  return errors;
}

export async function onRequestGet(context) {
  const programs = await listPrograms(context.env.DB, context.data.userEmail);
  return Response.json({ programs });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const metaErrors = checkMeta(body);
  const { errors: contentErrors } = validateProgram(body.content);
  const errors = [...metaErrors, ...contentErrors];
  if (errors.length > 0) {
    return Response.json({ error: "Invalid program", details: errors }, { status: 422 });
  }

  try {
    const id = crypto.randomUUID();
    const result = await createProgram(context.env.DB, context.data.userEmail, {
      id,
      name: body.name,
      sport: body.sport ?? null,
      content: body.content,
    });
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (e) {
    return Response.json({ error: "Could not create program" }, { status: 500 });
  }
}
