"use client";

import { useToastStore } from "@/stores/app-store";
import { X, AlertCircle, AlertTriangle, CheckCircle, Info } from "lucide-react";

const iconMap = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle,
  info: Info,
};

const colorMap = {
  error: "bg-red-500/10 border-red-500/30 text-red-400",
  warning: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  success: "bg-green-500/10 border-green-500/30 text-green-400",
  info: "bg-blue-500/10 border-blue-500/30 text-blue-400",
};

export function ToastContainer() {
  const { toasts, dismissToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm" role="alert" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border backdrop-blur-xl text-xs font-mono animate-in slide-in-from-right-5 ${colorMap[toast.type]}`}
          >
            <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span className="flex-1 leading-relaxed">{toast.message}</span>
            <button
              onClick={() => dismissToast(toast.id)}
              className="p-0.5 rounded hover:bg-white/10 transition-colors flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
