import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  const cookieStore = await cookies();
  const pendingLineUserId = cookieStore.get("pending_line_user_id")?.value ?? null;
  return NextResponse.json({ user, pendingLineUserId });
}
