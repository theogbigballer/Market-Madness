import { currentUser } from "../../../lib/auth/identity";

export async function GET() {
  const user = currentUser();
  return Response.json({ authenticated: true, id: user.id, email: user.email, username: user.username, displayName: user.displayName, isLocal: user.isLocal, isAdmin: user.isAdmin, mustChangePassword: user.mustChangePassword });
}
