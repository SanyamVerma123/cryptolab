import * as React from "react";
import { cn } from "@/lib/utils";

interface ShimmerTextProps {
  text: string;
  className?: string;
}

export function ShimmerText({ text, className }: ShimmerTextProps) {
  return (
    <span
      className={cn(
        "inline-block bg-gradient-to-r from-blue-600 via-sky-400 to-blue-600 bg-[length:200%_auto] bg-clip-text text-transparent animate-pulse",
        className
      )}
      style={{
        animation: "shimmer 2.2s linear infinite",
      }}
    >
      {text}
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </span>
  );
}
