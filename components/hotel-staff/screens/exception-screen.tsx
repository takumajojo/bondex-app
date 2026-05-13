"use client"

import { useState } from "react"
import { ArrowLeft, AlertTriangle, QrCode, RefreshCw, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "../i18n"
import { LanguageSwitcher } from "../language-switcher"

interface ExceptionScreenProps {
  type: "qr-damaged"
  onBack: () => void
}

export function ExceptionScreen({ type, onBack }: ExceptionScreenProps) {
  const { t } = useI18n()
  const [isReassigning, setIsReassigning] = useState(false)
  const [reassigned, setReassigned] = useState(false)

  const handleReassign = () => {
    setIsReassigning(true)
    setTimeout(() => {
      setIsReassigning(false)
      setReassigned(true)
    }, 1500)
  }

  if (reassigned) {
    return (
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-20 h-20 rounded-full bg-foreground text-background flex items-center justify-center mb-6">
            <CheckCircle className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2 text-center">{t("exception.reassignSuccess")}</h1>
          <p className="text-muted-foreground text-center mb-8">{t("exception.reassignSuccessDesc")}</p>
          <div className="w-full p-4 rounded-lg bg-muted/50 border border-border">
            <p className="text-sm text-muted-foreground text-center">
              <span className="font-medium text-foreground">{t("exception.note")}</span>{" "}
              {t("exception.noteDesc")}
            </p>
          </div>
        </div>
        <div className="p-4 border-t border-border bg-card">
          <Button onClick={onBack} className="w-full h-12">{t("exception.backToList")}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
      {}
      <header className="p-4 flex items-center gap-3 border-b border-border bg-card">
        <button 
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
          disabled={isReassigning}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="font-semibold text-foreground">{t("exception.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("exception.qrIssue")}</p>
        </div>
        <LanguageSwitcher />
      </header>

      {}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="p-6 rounded-lg bg-muted/50 border border-border text-center">
          <div className="w-16 h-16 rounded-full bg-foreground/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {type === "qr-damaged" && t("exception.qrDamaged")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {type === "qr-damaged" && t("exception.qrDamagedDesc")}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-card border border-border">
          <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
            <QrCode className="w-5 h-5" />
            {t("exception.resolution")}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">{t("exception.resolutionDesc")}</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-foreground" />
              <span>{t("exception.noReentry")}</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-foreground" />
              <span>{t("exception.noRepayment")}</span>
            </li>
          </ul>
        </div>
      </div>

      {}
      <div className="p-4 border-t border-border bg-card">
        <Button 
          onClick={handleReassign}
          disabled={isReassigning}
          className="w-full h-12"
        >
          <RefreshCw className={`w-5 h-5 mr-2 ${isReassigning ? "animate-spin" : ""}`} />
          {isReassigning ? t("exception.reassigning") : t("exception.reassign")}
        </Button>
      </div>
    </div>
  )
}
