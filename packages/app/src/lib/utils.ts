import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn-style class-name merge helper. Not used in PR #6 (data-dump
 * X-ray has no designed UI), but committed as part of the shadcn init so
 * PR #7+ can drop in `shadcn add <component>` without reshaping imports.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
