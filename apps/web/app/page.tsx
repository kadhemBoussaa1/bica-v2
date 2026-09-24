"use client";

import { useTranslations } from "next-intl";
import { canAccess } from "@repo/api-contract";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useCurrentUser } from "./auth/use-auth";
import { Dashboard } from "./dashboard/dashboard";
import styles from "./home.module.css";

/**
 * Modules the ERP will grow into. They are listed as planned rather than
 * hidden, so the app states its scope instead of looking empty — and none
 * pretend to be clickable until they exist.
 */
const MODULES = [
  { name: "productionName", body: "productionBody" },
  { name: "stockName", body: "stockBody" },
] as const;

/**
 * The signed-in home. A SUPER_ADMIN lands on the plant's dashboard
 * (docs/dashboard-plan.md); every other role keeps the welcome page.
 *
 * The role is branched on only once `me` has answered: rendering the
 * welcome page while it loads would flash it at every super admin before
 * the dashboard replaced it.
 */
export default function Home() {
  const { user, isPending } = useCurrentUser();

  if (isPending) {
    return (
      <div className={styles.page}>
        <TableSkeleton rows={4} />
      </div>
    );
  }
  if (user && canAccess(user.role, "SUPER_ADMIN")) {
    return <Dashboard name={user.name?.trim() || user.email} />;
  }
  return <Welcome name={user?.name?.trim() || user?.email} />;
}

function Welcome({ name }: { name: string | undefined }) {
  const t = useTranslations("home");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.greeting}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          {/* Full name, not a first-name split: "Super Admin" is a
              role-shaped name, and splitting it renders "Welcome back, Super." */}
          <h1 className={styles.title}>
            {name ? t("welcome", { name }) : t("welcomeAnon")}
          </h1>
        </div>
        <p className={styles.subtitle}>{t("subtitle")}</p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t("modules")}</h2>
          <p className={styles.sectionNote}>{t("plannedScope")}</p>
        </div>
        <div className={styles.modules}>
          {MODULES.map((module) => (
            <div key={module.name} className={styles.module}>
              <div className={styles.moduleName}>{t(module.name)}</div>
              <p className={styles.moduleBody}>{t(module.body)}</p>
              <span className={styles.modulePlanned}>{t("planned")}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
