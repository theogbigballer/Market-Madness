import { getD1 } from "../../../../db/runtime";
import { changePassword, currentUser } from "../../../../lib/auth/identity";
export async function POST(request: Request) { try { const body = await request.json() as { password?: string }; await changePassword(getD1(), currentUser(), body.password || ""); return Response.json({ changed: true }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to change password." }, { status: 400 }); } }
