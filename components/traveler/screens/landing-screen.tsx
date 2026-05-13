"use client"

import Image from "next/image"
import { Button } from "@/components/ui/button"
import { ChevronLeft } from "lucide-react"

interface LandingScreenProps {
  onNext: () => void
  onBack: () => void
}

export function LandingScreen({ onNext, onBack }: LandingScreenProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background max-w-md mx-auto w-full">
      {}
      <div className="px-4 pt-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Home</span>
        </button>
      </div>

      {}
      <div className="flex-1 flex flex-col">
        {}
        <div className="relative w-full aspect-[4/3] mt-4">
          <Image
            src="/hero-luggage-delivery.jpg"
            alt="Luggage being delivered to your next destination"
            fill
            className="object-contain"
            priority
          />
        </div>

        {}
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
          <h1 className="text-3xl font-semibold text-foreground text-center leading-tight tracking-tight text-balance">
            Your luggage goes ahead.
            <br />
            You travel light.
          </h1>
          
          <p className="mt-4 text-base text-muted-foreground text-center">
            Delivered to your next stop.
          </p>

          {}
          <div className="mt-8 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg className="w-4 h-4 text-muted-foreground/70" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span>{"Japan's delivery infrastructure, built in"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg className="w-4 h-4 text-muted-foreground/70" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span>Reliable by design</span>
            </div>
          </div>
        </div>
      </div>

      {}
      <div className="sticky bottom-0 p-6 pb-8 bg-gradient-to-t from-background via-background to-transparent">
        <Button 
          onClick={onNext}
          className="w-full h-14 text-lg font-medium rounded-xl shadow-lg"
        >
          Send my luggage
        </Button>
      </div>
    </div>
  )
}
