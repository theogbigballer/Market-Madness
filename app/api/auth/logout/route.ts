import { getD1 } from "../../../../db/runtime";
import { logout } from "../../../../lib/auth/identity";
export async function POST(request: Request) { return Response.json({ signedOut: true }, { headers: { "set-cookie": await logout(request, getD1()), "cache-control": "no-store" } }); }
