"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { TravelerFlow } from "@/components/traveler/traveler-flow"
import { HotelStaffFlow } from "@/components/hotel-staff/hotel-staff-flow"
import { AdminDashboard } from "@/components/admin/admin-dashboard"
import { Briefcase, Building2, Shield, GitBranch, FileText, History } from "lucide-react"
import Link from "next/link"

type Role = "traveler" | "hotel" | "admin" | null

function BondExWireframesContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [selectedRole, setSelectedRole] = useState<Role>(null)
  const [initialStep, setInitialStep] = useState<string | null>(null)

  useEffect(() => {
    const role = searchParams.get("role") as Role
    const step = searchParams.get("step")
    if (role) {
      setSelectedRole(role)
      setInitialStep(step)
    }
  }, [searchParams])

  const handleBack = () => {
    setSelectedRole(null)
    setInitialStep(null)
    router.push("/")
  }

  if (selectedRole === "traveler") {
    return <TravelerFlow onBack={handleBack} initialStep={initialStep} />
  }

  if (selectedRole === "hotel") {
    return <HotelStaffFlow onBack={handleBack} initialStep={initialStep} />
  }

  if (selectedRole === "admin") {
    return <AdminDashboard onBack={handleBack} initialScreen={initialStep} />
  }

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-muted-foreground text-sm mb-4">
            Wireframes
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-3">
            BondEx
          </h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto text-balance">
            Luggage delivery platform for international travelers in Japan
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <button
            onClick={() => setSelectedRole("traveler")}
            className="group p-6 rounded-lg border-2 border-border bg-card hover:border-foreground transition-all text-left"
          >
            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center mb-4 group-hover:bg-foreground group-hover:text-background transition-colors">
              <Briefcase className="w-6 h-6" />
            </div>
            <h2 className="font-semibold text-lg text-foreground mb-2">Traveler</h2>
            <p className="text-sm text-muted-foreground">
              Mobile-first web app for booking luggage delivery
            </p>
            <div className="mt-4 text-xs text-muted-foreground">
              7 screens
            </div>
          </button>

          <button
            onClick={() => setSelectedRole("hotel")}
            className="group p-6 rounded-lg border-2 border-border bg-card hover:border-foreground transition-all text-left"
          >
            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center mb-4 group-hover:bg-foreground group-hover:text-background transition-colors">
              <Building2 className="w-6 h-6" />
            </div>
            <h2 className="font-semibold text-lg text-foreground mb-2">Hotel Staff</h2>
            <p className="text-sm text-muted-foreground">
              Tablet/mobile web app for check-in processing
            </p>
            <div className="mt-4 text-xs text-muted-foreground">
              5 screens
            </div>
          </button>

          <button
            onClick={() => setSelectedRole("admin")}
            className="group p-6 rounded-lg border-2 border-border bg-card hover:border-foreground transition-all text-left"
          >
            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center mb-4 group-hover:bg-foreground group-hover:text-background transition-colors">
              <Shield className="w-6 h-6" />
            </div>
            <h2 className="font-semibold text-lg text-foreground mb-2">Admin / CS</h2>
            <p className="text-sm text-muted-foreground">
              Desktop dashboard for operations and support
            </p>
            <div className="mt-4 text-xs text-muted-foreground">
              4 screens
            </div>
          </button>
        </div>

        <div className="mt-12 p-4 rounded-lg bg-muted/50 border border-border">
          <p className="text-sm text-muted-foreground text-center">
            <span className="font-medium text-foreground">Design Philosophy:</span> Decision OS that eliminates human judgment, stays silent during normal operations, surfaces only the next single action during exceptions.
          </p>
        </div>

        <div className="mt-6 flex justify-center gap-4">
          <Link
            href="/flowchart"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm text-muted-foreground hover:text-foreground"
          >
            <GitBranch className="w-4 h-4" />
            Screen Flow
          </Link>
          <Link
            href="/requirements"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm text-muted-foreground hover:text-foreground"
          >
            <FileText className="w-4 h-4" />
            Requirements
          </Link>
          <Link
            href="/changelog"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm text-muted-foreground hover:text-foreground"
          >
            <History className="w-4 h-4" />
            Changelog
          </Link>
        </div>
      </div>
    </main>
  )
}

export default function BondExWireframes() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="text-muted-foreground">Loading...</div></div>}>
      <BondExWireframesContent />
    </Suspense>
  )
}
