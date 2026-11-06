"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

export function PendingSubmitButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={
        className ??
        "w-full inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
      }
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}
