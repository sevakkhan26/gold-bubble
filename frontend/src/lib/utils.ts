import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatToman(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function formatUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 5) return "همین الان";
  if (sec < 60) return `${sec} ثانیه پیش`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} دقیقه پیش`;
  const h = Math.floor(min / 60);
  return `${h} ساعت پیش`;
}
