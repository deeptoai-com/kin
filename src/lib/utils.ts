import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

/**
 * Intlayer content values may be exposed as non-strings at runtime (SSR/hydration),
 * or as locale objects like { en: '...', zh: '...' } before resolution.
 * Use this before calling .replace() on any content.xxx to avoid "replace is not a function",
 * and to avoid rendering "[object Object]" when the value is an object.
 * @param value - Content value (string or locale object)
 * @param locale - Optional locale (e.g. from useLocale()) for SSR when document is not available
 */
export function toLocalizedString(value: unknown, locale?: string): string {
    if (typeof value === "string") return value;
    if (value == null) return "";
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        // Intlayer nodes expose the raw localized string via `.value`.
        const raw = (obj as { value?: unknown }).value;
        if (raw !== undefined) {
            if (typeof raw === "string") return raw;
            if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
                return String(raw);
            }
            if (raw && typeof raw === "object") {
                const nested = toLocalizedString(raw, locale);
                if (nested) return nested;
            }
        }
        // Handle unwrapped translation nodes { nodeType: 'translation', translation: { en: '...' } }.
        if ("translation" in obj && obj.translation && typeof obj.translation === "object") {
            const nested = toLocalizedString(obj.translation, locale);
            if (nested) return nested;
        }
        // 1) Explicit locale (SSR / passed from useLocale())
        if (locale && typeof obj[locale] === "string") return obj[locale] as string;
        const baseLocale = locale?.split("-")[0];
        if (baseLocale && typeof obj[baseLocale] === "string") return obj[baseLocale] as string;
        // 2) Client: current document lang
        if (typeof document !== "undefined" && document.documentElement?.lang) {
            const lang = document.documentElement.lang;
            if (typeof obj[lang] === "string") return obj[lang] as string;
            const base = lang.split("-")[0];
            if (typeof obj[base] === "string") return obj[base] as string;
        }
        // 3) Fallback: en -> zh -> first string value (avoids "[object Object]")
        if (typeof obj.en === "string") return obj.en;
        if (typeof obj.zh === "string") return obj.zh;
        const first = Object.values(obj).find((v) => typeof v === "string");
        if (typeof first === "string") return first;
    }
    return String(value);
}
