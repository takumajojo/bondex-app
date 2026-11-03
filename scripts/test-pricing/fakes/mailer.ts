// テスト用: メール送信はしない。
export async function sendMail() { return { sent: false } }
export const mailerConfigured = () => false
