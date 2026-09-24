"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "./actions";
import { LANGUAGES } from "./config";

/**
 * The language list. Picking one writes the cookie through a server action
 * and refreshes the tree, so server-rendered text, `lang` and `dir` all
 * change together. Labels are each language's own name, deliberately not
 * translated — a reader who cannot read the current language must still
 * find their own.
 */
export function LanguagePicker({
  className,
  label,
}: {
  className?: string;
  /** Accessible name; the visible control is the select itself. */
  label: string;
}) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      className={className}
      aria-label={label}
      value={locale}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(async () => {
          await setLocale(next);
          router.refresh();
        });
      }}
    >
      {LANGUAGES.map((language) => (
        <option key={language.code} value={language.code}>
          {language.label}
        </option>
      ))}
    </select>
  );
}
