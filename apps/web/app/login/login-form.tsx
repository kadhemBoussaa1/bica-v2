"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useCurrentUser, useSignIn } from "../auth/use-auth";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/field";
import styles from "./login.module.css";

/** Where to land after a successful sign-in. */
const DEFAULT_REDIRECT = "/";

export function LoginForm() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const signIn = useSignIn();
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pending = signIn.isPending;

  /**
   * Read `?next=` at submit time from the live URL. Only same-origin relative
   * paths are honoured, so a crafted `?next=https://evil.example` cannot turn
   * this into an open redirect.
   */
  function safeRedirect() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
    return DEFAULT_REDIRECT;
  }

  // Someone who still holds a valid session has no business on this page.
  useEffect(() => {
    if (user) router.replace(safeRedirect());
  }, [user, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await signIn.mutateAsync({ email, password });
    } catch (cause) {
      // The API deliberately returns the same message for an unknown email and
      // a wrong password, so it never reveals which accounts exist. Keep that.
      setError(
        cause instanceof Error ? cause.message : t("failed"),
      );
      return;
    }

    // refresh() re-runs server components so anything reading the session
    // picks up the new cookie.
    router.replace(safeRedirect());
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.heading}>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.subtitle}>{t("subtitle")}</p>
      </div>

      <div className={styles.fields}>
        <TextField
          label={t("email")}
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          disabled={pending}
        />
        <TextField
          label={t("password")}
          type="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </div>

      {error && (
        <div className={styles.alert} role="alert">
          <span className={styles.alertMark} aria-hidden>
            !
          </span>
          <span>{error}</span>
        </div>
      )}

      <Button
        variant="primary"
        type="submit"
        className={styles.submit}
        disabled={pending}
      >
        {pending ? t("signingIn") : t("signIn")}
      </Button>

      <p className={styles.note}>{t("note")}</p>
    </form>
  );
}
