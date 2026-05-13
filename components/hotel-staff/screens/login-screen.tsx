"use client"

import { useState } from "react"
import { ArrowLeft, Building2, Lock, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "../i18n"
import { LanguageSwitcher } from "../language-switcher"

interface LoginScreenProps {
  onLogin: () => void
  onBack: () => void
}


const DEMO_CREDENTIALS: Record<string, string> = {
  "SAKURA01": "bondex2026",
  "KYOTO02":  "bondex2026",
  "OSAKA03":  "bondex2026",
  "DEMO":     "demo",
}

export function LoginScreen({ onLogin, onBack }: LoginScreenProps) {
  const { t } = useI18n()
  const [hotelCode, setHotelCode] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setError(null)
    setIsLoading(true)
    await new Promise(r => setTimeout(r, 200 + Math.random() * 200))
    const code = hotelCode.trim().toUpperCase()
    const expectedPassword = DEMO_CREDENTIALS[code]
    if (!expectedPassword) {
      setError("Hotel code not found. Please contact BondEx support.")
      setIsLoading(false)
      return
    }
    if (password !== expectedPassword) {
      setError("Incorrect password.")
      setIsLoading(false)
      return
    }
    sessionStorage.setItem("bondex_hotel_session", JSON.stringify({
      hotelCode: code,
      loginAt: Date.now(),
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    }))
    onLogin()
  }

  const canSubmit = hotelCode.trim().length > 0 && password.length > 0

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
      <header className="p-4 flex items-center justify-between">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <LanguageSwitcher />
      </header>
      <div className="flex-1 flex flex-col justify-center px-6 pb-12">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-foreground flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-background" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">{t("login.title")}</h1>
          <p className="text-muted-foreground">{t("login.subtitle")}</p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("login.hotelCode")}</label>
            <Input placeholder={t("login.hotelCodePlaceholder")} value={hotelCode} onChange={(e) => setHotelCode(e.target.value)} disabled={isLoading} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Lock className="w-4 h-4" />
              {t("login.password")}
            </label>
            <Input type="password" placeholder={t("login.passwordPlaceholder")} value={password} onChange={(e) => setPassword(e.target.value)} disabled={isLoading} />
          </div>
          <Button onClick={handleSubmit} disabled={!canSubmit || isLoading} className="w-full h-12 mt-2">
            {isLoading ? t("login.loading") : t("login.submit")}
          </Button>
          <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border space-y-1.5">
            <p className="text-[10px] font-bold text-muted-foreground text-center uppercase tracking-wider">Demo Credentials</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="text-right font-mono font-bold">DEMO</span><span className="font-mono">demo</span>
              <span className="text-right font-mono font-bold">SAKURA01</span><span className="font-mono">bondex2026</span>
              <span className="text-right font-mono font-bold">KYOTO02</span><span className="font-mono">bondex2026</span>
              <span className="text-right font-mono font-bold">OSAKA03</span><span className="font-mono">bondex2026</span>
            </div>
          </div>
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground text-center mt-6">{t("login.session")}</p>
      </div>
    </div>
  )
}
