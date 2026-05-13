const getBaseUrl = () =>
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL) || "http://localhost:8000"

export async function uploadPhoto(file: File): Promise<{ photoId: string; photoUrl: string }> {
  const baseUrl = getBaseUrl()
  const formData = new FormData()
  formData.append("file", file)

  const res = await fetch(`${baseUrl}/api/photos/upload`, {
    method: "POST",
    body: formData,
  })

  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    
  }

  if (!res.ok) {
    const message = data?.error || data?.detail || text || res.statusText
    throw new Error(message)
  }

  const photoId = String(data?.photoId || "")
  const urlPath = String(data?.url || "")
  if (!photoId || !urlPath) throw new Error("Invalid upload response")

  return { photoId, photoUrl: `${baseUrl}${urlPath}` }
}

