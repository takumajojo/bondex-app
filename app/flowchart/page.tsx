"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";


function FlowNode({ 
  label, 
  sub, 
  highlight = false,
  conditional = false,
  href
}: { 
  label: string; 
  sub?: string;
  highlight?: boolean;
  conditional?: boolean;
  href?: string;
}) {
  const content = (
    <div 
      className={`
        px-4 py-3 rounded-lg border text-center min-w-[120px] transition-all
        ${conditional 
          ? "border-dashed border-muted-foreground/50 bg-muted/30" 
          : highlight 
            ? "border-foreground bg-foreground text-background" 
            : "border-border bg-card"
        }
        ${href ? "cursor-pointer hover:scale-105 hover:shadow-md" : ""}
      `}
    >
      <div className={`text-sm font-medium ${conditional ? "text-muted-foreground" : ""}`}>{label}</div>
      {sub && <div className={`text-xs mt-0.5 ${highlight ? "text-background/70" : "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}


function Arrow({ direction = "down", label }: { direction?: "down" | "right" | "branch-left" | "branch-right"; label?: string }) {
  if (direction === "down") {
    return (
      <div className="flex flex-col items-center py-2">
        <div className="w-px h-6 bg-border" />
        <svg width="12" height="8" viewBox="0 0 12 8" className="text-border">
          <path d="M6 8L0 0h12L6 8z" fill="currentColor" />
        </svg>
        {label && <span className="text-xs text-muted-foreground mt-1">{label}</span>}
      </div>
    );
  }
  return null;
}


function LoopBack({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <svg width="20" height="24" viewBox="0 0 20 24" className="text-border">
        <path d="M10 0v8M10 8c0 4-8 4-8 8v8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2 20l-2 4h4l-2-4z" fill="currentColor" />
      </svg>
      {label && <span>{label}</span>}
    </div>
  );
}

export default function FlowchartPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDownload = () => {
    if (!containerRef.current) return;
    
    
    const flowText = `
BondEx Screen Flow

=== TRAVELER FLOW (Mobile) ===
Landing → Step 1: Destination
  ↓ (if similar hotels) → Step 1.5: Disambiguation
  ↓ (no duplicates) → Step 2: Delivery Date
→ Step 3: Luggage Details → Step 4: Contact Info + Verify → Step 5: Payment → Confirmed → Status Dashboard

=== HOTEL STAFF FLOW (Tablet) ===
Login → Order List → Check-in
  ↓ Accept → Accept Success → (back to Order List)
  ↓ Reject → Exception → (back to Order List)

=== ADMIN/CS DASHBOARD (Desktop) ===
Dashboard Overview
  → Order List → Order Detail
  → Payment Failures → Order Detail
  → Order Detail (direct)
    `;
    
    const blob = new Blob([flowText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bondex-flowchart.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      {}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-lg font-semibold">BondEx Screen Flow</h1>
              <p className="text-sm text-muted-foreground">All user roles and screen transitions</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>
        </div>
      </header>

      {}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-wrap gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-card border border-border" />
            <span className="text-muted-foreground">Screen</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border border-dashed border-muted-foreground/50 bg-muted/30" />
            <span className="text-muted-foreground">Conditional</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-border" />
            <span className="text-muted-foreground">Navigation</span>
          </div>
        </div>
      </div>

      {}
      <div ref={containerRef} className="max-w-7xl mx-auto px-4 pb-12">
        <div className="grid lg:grid-cols-3 gap-8">
          
          {}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="mb-6">
              <h3 className="font-semibold text-lg">Traveler Flow</h3>
              <p className="text-sm text-muted-foreground">Mobile-first</p>
            </div>
            
            <div className="flex flex-col items-center">
              <FlowNode label="Landing" sub="Top page" highlight href="/?role=traveler&step=landing" />
              <Arrow direction="down" />
              <FlowNode label="Step 1" sub="Destination" href="/?role=traveler&step=destination" />
              
              {}
              <div className="flex items-start gap-4 mt-2">
                <div className="flex flex-col items-center">
                  <div className="text-xs text-muted-foreground mb-2">Similar hotels</div>
                  <FlowNode label="Step 1.5" sub="Disambiguation" conditional href="/?role=traveler&step=destination" />
                </div>
              </div>
              
              <Arrow direction="down" />
              <FlowNode label="Step 2" sub="Delivery date" href="/?role=traveler&step=delivery-date" />
              <Arrow direction="down" />
              <FlowNode label="Step 3" sub="Luggage details" href="/?role=traveler&step=luggage" />
              <Arrow direction="down" />
              <FlowNode label="Step 4" sub="Contact info + verify" href="/?role=traveler&step=contact" />
              <Arrow direction="down" />
              <FlowNode label="Step 5" sub="Payment" href="/?role=traveler&step=payment" />
              <Arrow direction="down" />
              <FlowNode label="Confirmed" sub="Booking complete" href="/?role=traveler&step=completion" />
              <Arrow direction="down" />
              <FlowNode label="Status" sub="Tracking" href="/?role=traveler&step=status" />
            </div>
          </div>

          {}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="mb-6">
              <h3 className="font-semibold text-lg">Hotel Staff Flow</h3>
              <p className="text-sm text-muted-foreground">Tablet-optimized</p>
            </div>
            
            <div className="flex flex-col items-center">
              <FlowNode label="Login" highlight href="/?role=hotel&step=login" />
              <Arrow direction="down" />
              <FlowNode label="Order List" sub="Today's deliveries" href="/?role=hotel&step=order-list" />
              <Arrow direction="down" />
              <FlowNode label="Check-in" sub="QR scan" href="/?role=hotel&step=check-in" />
              
              {}
              <div className="flex gap-8 mt-4">
                <div className="flex flex-col items-center">
                  <div className="text-xs text-muted-foreground mb-2">Accept</div>
                  <FlowNode label="Success" sub="Print label" href="/?role=hotel&step=accept-success" />
                  <div className="mt-2">
                    <LoopBack label="Back to list" />
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  <div className="text-xs text-muted-foreground mb-2">Reject</div>
                  <FlowNode label="Exception" sub="Report issue" href="/?role=hotel&step=exception" />
                  <div className="mt-2">
                    <LoopBack label="Back to list" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="mb-6">
              <h3 className="font-semibold text-lg">Admin / CS</h3>
              <p className="text-sm text-muted-foreground">Desktop dashboard</p>
            </div>
            
            <div className="flex flex-col items-center">
              <FlowNode label="Dashboard" sub="Overview" highlight href="/?role=admin&step=overview" />
              
              {}
              <div className="flex gap-4 mt-4">
                <div className="flex flex-col items-center">
                  <Arrow direction="down" />
                  <FlowNode label="Order List" sub="All orders" href="/?role=admin&step=orders" />
                </div>
                <div className="flex flex-col items-center">
                  <Arrow direction="down" />
                  <FlowNode label="Payments" sub="Failures" href="/?role=admin&step=payment-failure" />
                </div>
              </div>
              
              {}
              <div className="flex items-center gap-2 mt-4">
                <div className="w-20 h-px bg-border" />
                <div className="w-20 h-px bg-border" />
              </div>
              <Arrow direction="down" />
              <FlowNode label="Order Detail" sub="Full info + actions" href="/?role=admin&step=order-detail" />

              {}
              <div className="w-full border-t border-dashed border-border my-6" />
              <FlowNode label="Hotels" sub="Hotel list" href="/?role=admin&step=hotels" />
              <Arrow direction="down" />
              <FlowNode label="Register Hotel" sub="Admin only" href="/?role=admin&step=hotel-register" />
            </div>
          </div>

        </div>
      </div>

      {}
      <div className="max-w-7xl mx-auto px-4 pb-12">
        <div className="bg-muted/50 border border-border rounded-xl p-6">
          <h3 className="font-semibold mb-4">Design Philosophy</h3>
          <div className="grid md:grid-cols-3 gap-6 text-sm">
            <div>
              <div className="font-medium mb-1">Traveler</div>
              <p className="text-muted-foreground">Linear 6-step flow (Destination, Delivery Date, Luggage, Contact + Verify, Payment, Confirmed). Step 1.5 appears only when hotel disambiguation is needed.</p>
            </div>
            <div>
              <div className="font-medium mb-1">Hotel Staff</div>
              <p className="text-muted-foreground">Order List as central hub. Accept/Reject are the only decisions. Always returns to list after action.</p>
            </div>
            <div>
              <div className="font-medium mb-1">Admin/CS</div>
              <p className="text-muted-foreground">Exception-focused dashboard. Action items surface automatically. Order Detail is the deep-dive view.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
