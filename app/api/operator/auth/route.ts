import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

const COOKIE_NAME = "bondex_op_auth"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "operator-auth")
  if (!limit.ok) return limit.response

  const expected = process.env.OPERATOR_PASSWORD
  if (!expected) {
    return NextResponse.json({ error: "OPERATOR_PASSWORD not configured" }, { status: 503 })
  }

  let body: { password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const password = typeof body.password === "string" ? body.password : ""

  if (password !== expected) {
    return NextResponse.json({ error: "Password doesn't match" }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: COOKIE_NAME,
    value: expected,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  })
  return res
}
