import React from "react";
import { Loader2 } from "lucide-react";

export function PageLoader({ label = "Loading section..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] w-full py-16">
      <div className="flex flex-col items-center gap-3.5 rounded-2xl bg-white/90 backdrop-blur-xs border border-slate-200/80 px-8 py-6 shadow-sm">
        <div className="relative flex items-center justify-center">
          <div className="h-10 w-10 rounded-full border-2 border-blue-100 animate-ping absolute" />
          <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center">
            <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800">{label}</p>
          <p className="text-xs text-slate-500 mt-0.5">Please wait a moment</p>
        </div>
      </div>
    </div>
  );
}
