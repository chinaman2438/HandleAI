"use client";

import React, { useState } from "react";

interface FileInputProps {
  name: string;
  accept?: string;
  required?: boolean;
  disabled?: boolean;
  buttonVariant?: "primary" | "neutral";
  className?: string;
}

export function FileInput({
  name,
  accept,
  required = false,
  disabled = false,
  buttonVariant = "neutral",
  className = "",
}: FileInputProps) {
  const [fileName, setFileName] = useState<string>("");

  return (
    <div
      className={`relative flex items-center gap-2.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 ${
        disabled ? "opacity-60 pointer-events-none" : ""
      } ${className}`}
    >
      <span
        className={`shrink-0 rounded-md px-3 py-1 text-xs font-semibold transition-colors select-none ${
          buttonVariant === "primary"
            ? "bg-blue-600 text-white"
            : "border border-slate-300 bg-white text-slate-800"
        }`}
      >
        Choose File
      </span>
      <span className="truncate text-xs text-slate-600">
        {fileName || "No file chosen"}
      </span>
      <input
        type="file"
        name={name}
        accept={accept}
        required={required}
        disabled={disabled}
        onChange={(e) => {
          e.currentTarget.setCustomValidity("");
          const file = e.currentTarget.files?.[0];
          setFileName(file ? file.name : "");
        }}
        onInvalid={(e) => {
          if (e.currentTarget.validity.valueMissing) {
            e.currentTarget.setCustomValidity("Please select a file.");
          }
        }}
        className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
      />
    </div>
  );
}
