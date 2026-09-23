export async function onRequestGet(context) {
  return Response.json({ email: context.data.userEmail });
}
