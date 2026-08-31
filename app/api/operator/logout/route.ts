import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// 新旧両方の cookie を消す (旧=生パスワード保存の bondex_op_auth は 2026-08-31 廃止)
const COOKIE_NAMES = ["bondex_op_session", "bondex_op_auth"]

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  for (const name of COOKIE_NAMES) {
    res.cookies.set({
      name,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    })
  }
  return res
}
