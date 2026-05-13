import { NextRequest, NextResponse } from "next/server"

type EmailType = "booking_confirmed" | "delivery_complete" | "label_generated"

interface EmailPayload {
  type: EmailType
  to: string
  orderId: string
  guestName?: string
  deliveryDate?: string
  destination?: string
  trackingNumber?: string
}

function buildEmail(payload: EmailPayload): { subject: string; html: string } {
  const { type, orderId, guestName = "Guest", deliveryDate, destination, trackingNumber } = payload

  switch (type) {
    case "booking_confirmed":
      return {
        subject: `[BondEx] Booking Confirmed — ${orderId}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
            <h2 style="color:#1B3A6B">Your luggage delivery is confirmed</h2>
            <p>Hi ${guestName},</p>
            <p>Your luggage delivery has been successfully booked.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:8px;background:#f5f7fa;font-weight:bold">Order ID</td><td style="padding:8px">${orderId}</td></tr>
              <tr><td style="padding:8px;background:#f5f7fa;font-weight:bold">Destination</td><td style="padding:8px">${destination ?? "—"}</td></tr>
              <tr><td style="padding:8px;background:#f5f7fa;font-weight:bold">Delivery Date</td><td style="padding:8px">${deliveryDate ?? "—"}</td></tr>
            </table>
            <p><strong>What to do next:</strong></p>
            <ol>
              <li>Bring your luggage to the hotel front desk</li>
              <li>Show the QR code in your BondEx app</li>
              <li>Staff will attach the label — you're done!</li>
            </ol>
            <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
            <p style="font-size:12px;color:#888">BondEx by JOJO Corporation</p>
          </div>
        `,
      }

    case "delivery_complete":
      return {
        subject: `[BondEx] Your luggage has arrived — ${orderId}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
            <h2 style="color:#1B3A6B">Your luggage has arrived</h2>
            <p>Hi ${guestName},</p>
            <p>Your luggage has been delivered to <strong>${destination ?? "your destination"}</strong>.</p>
            ${trackingNumber ? `<p>Tracking number: <strong>${trackingNumber}</strong></p>` : ""}
            <p>Please pick it up at the front desk.</p>
            <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
            <p style="font-size:12px;color:#888">BondEx by JOJO Corporation</p>
          </div>
        `,
      }

    case "label_generated":
      return {
        subject: `[BondEx] Shipping label generated — ${orderId}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
            <h2 style="color:#1B3A6B">Shipping label generated</h2>
            <p>Order <strong>${orderId}</strong> has been checked in by hotel staff.</p>
            ${trackingNumber ? `<p>Yamato tracking number: <strong>${trackingNumber}</strong></p>` : ""}
            <p>Your luggage is now in transit.</p>
            <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
            <p style="font-size:12px;color:#888">BondEx by JOJO Corporation</p>
          </div>
        `,
      }

    default:
      return { subject: `[BondEx] Notification — ${orderId}`, html: `<p>Order: ${orderId}</p>` }
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload: EmailPayload = await req.json()

    if (!payload.to || !payload.type || !payload.orderId) {
      return NextResponse.json({ error: "Missing required fields: to, type, orderId" }, { status: 400 })
    }

    const { subject, html } = buildEmail(payload)

    if (process.env.NODE_ENV !== "production" || !process.env.RESEND_API_KEY) {
      console.log("[BondEx Email Mock]", {
        to: payload.to,
        subject,
        preview: html.replace(/<[^>]+>/g, "").trim().slice(0, 120) + "...",
      })
      return NextResponse.json({
        success: true,
        mock: true,
        message: "Email logged to console (mock mode). Set RESEND_API_KEY to send real emails.",
        subject,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[BondEx Email] Error:", error)
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 })
  }
}
