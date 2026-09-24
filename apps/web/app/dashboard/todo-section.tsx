"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { numberFormat } from "../../i18n/formats";
import { formatShiftDate } from "../shifts/week";
import { Arrow, Dot } from "./section";
import { countOf, type Summary } from "./summary";
import styles from "./dashboard.module.css";

const int = () => numberFormat({ maximumFractionDigits: 0 });

/** Trouble, something to plan, something waiting on someone — in that order. */
type Tone = "danger" | "attention" | "info";

const TONE_CLASS: Record<Tone, string | undefined> = {
  danger: styles.todoDanger,
  attention: styles.todoAttention,
  info: styles.todoInfo,
};

export interface Todo {
  key: string;
  tone: Tone;
  count: number;
  href: string;
  title: string;
  meta: string;
}

/**
 * Everything on the page that asks for a decision. Built from the same
 * summary as the panels below, so it cannot name a problem they do not
 * show. Exported for the header's sentence, which counts the same list.
 *
 * Deliberately left out: employees not on a shift (most of the roster in
 * any normal week, so it would never clear) and an open stocktake (work in
 * progress with its own screen, not a decision — `Dashboard v3.dc.html`
 * drops it too).
 */
export function useTodos(data: Summary): Todo[] {
  const t = useTranslations("dashboard.todo");
  const enums = useTranslations("enums");
  const { shifts, stock, money } = data;
  const planner = `/shifts?week=${shifts.weekStart}`;

  const all: Todo[] = [
    {
      key: "overdueSales",
      tone: "danger",
      count: countOf(money.sales.overdue),
      href: "/invoices/sales",
      title: t("overdueSales", { count: countOf(money.sales.overdue) }),
      meta: t("overdueSalesMeta"),
    },
    {
      key: "overduePurchases",
      tone: "danger",
      count: countOf(money.purchases.overdueInvoices),
      href: "/invoices/purchases",
      title: t("overduePurchases", { count: countOf(money.purchases.overdueInvoices) }),
      meta: t("overduePurchasesMeta"),
    },
    {
      key: "lateOrders",
      tone: "danger",
      count: money.purchases.lateOrders,
      href: "/purchasing/orders",
      title: t("lateOrders", { count: money.purchases.lateOrders }),
      meta: t("lateOrdersMeta"),
    },
    {
      key: "missedTickets",
      tone: "danger",
      count: shifts.tickets.missed,
      href: "/shifts",
      title: t("missedTickets", { count: shifts.tickets.missed }),
      meta: t("missedTicketsMeta"),
    },
    {
      key: "inksOut",
      tone: "danger",
      count: stock.inks.out,
      href: "/stock/inks",
      title: t("inksOut", { count: stock.inks.out }),
      meta: t("inksOutMeta"),
    },
    {
      key: "weekNotOpened",
      tone: "attention",
      count: shifts.week === null ? 1 : 0,
      href: planner,
      title: t("weekNotOpened"),
      meta: t("weekNotOpenedMeta", { date: formatShiftDate(shifts.weekStart) }),
    },
    {
      key: "weekDraft",
      tone: "attention",
      count: shifts.week?.status === "DRAFT" ? 1 : 0,
      href: planner,
      title: t("weekDraft"),
      meta: t("weekDraftMeta"),
    },
    {
      key: "emptyShifts",
      tone: "attention",
      count: shifts.week?.emptyShifts.length ?? 0,
      href: planner,
      title: t("emptyShifts", { count: shifts.week?.emptyShifts.length ?? 0 }),
      meta: t("emptyShiftsMeta", {
        shifts: (shifts.week?.emptyShifts ?? []).map((type) => enums(`shiftType.${type}`)).join(", "),
      }),
    },
    {
      key: "inksLow",
      tone: "attention",
      count: stock.inks.low,
      href: "/stock/inks",
      title: t("inksLow", { count: stock.inks.low }),
      meta: t("inksLowMeta"),
    },
    {
      key: "requests",
      tone: "info",
      count: shifts.pendingRequests,
      href: "/shifts/requests",
      title: t("requests", { count: shifts.pendingRequests }),
      meta: t("requestsMeta"),
    },
    {
      key: "receiving",
      tone: "info",
      count: stock.receiving.deliveries,
      href: "/stock/receiving",
      title: t("receiving", { count: stock.receiving.deliveries }),
      meta: t("receivingMeta", { count: stock.receiving.reels }),
    },
  ];
  return all.filter((todo) => todo.count > 0);
}

/** "À traiter": one card per point, its count large in the point's tone. */
export function TodoSection({ todos }: { todos: Todo[] }) {
  const t = useTranslations("dashboard.todo");
  const total = todos.reduce((sum, todo) => sum + todo.count, 0);

  return (
    <section className={styles.panel} aria-label={t("title")}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t("title")}</h2>
        <span className={styles.panelCount}>
          {todos.length > 0 ? t("count", { points: todos.length, items: total }) : null}
        </span>
      </div>
      {todos.length === 0 ? (
        <p className={styles.todoClear}>
          <Dot tone="ok" />
          {t("clear")}
        </p>
      ) : (
        <div className={styles.todoGrid}>
          {todos.map((todo) => (
            <Link
              key={todo.key}
              href={todo.href}
              className={[styles.todo, TONE_CLASS[todo.tone]].filter(Boolean).join(" ")}
            >
              <span className={styles.todoCount}>{int().format(todo.count)}</span>
              <span className={styles.todoText}>
                <span className={styles.todoTitle}>{todo.title}</span>
                <span className={styles.todoMeta}>{todo.meta}</span>
              </span>
              <span className={styles.todoArrow}>
                <Arrow />
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
