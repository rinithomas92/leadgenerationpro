import { NextResponse } from "next/server";
import { ownerCookie } from "@/lib/owner-auth";
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(ownerCookie);
  return response;
}
