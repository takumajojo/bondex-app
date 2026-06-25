import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

const COOKIE_NAME = "bondex_op_auth"

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return res
}
