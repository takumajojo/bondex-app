/**
 * 写真アップロード用クライアント。
 * POC では Next.js 内部 API Route (/api/photos/upload) に直接送信し、
 * サーバーメモリに保管された画像を /api/photos/{photoId} で取り出す。
 */

export async function uploadPhoto(file: File): Promise<{ photoId: string; photoUrl: string }> {
  const formData = new FormData()
  formData.append("file", file)

  const res = await fetch("/api/photos/upload", {
    method: "POST",
    body: formData,
  })

  const text = await res.text()
  let data: { photoId?: string; url?: string; error?: string } | null = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // ignore non-JSON body
  }

  if (!res.ok) {
    const message = data?.error || text || res.statusText
    throw new Error(message)
  }

  const photoId = String(data?.photoId || "")
  if (!photoId) throw new Error("Invalid upload response")

  return { photoId, photoUrl: `/api/photos/${photoId}` }
}
