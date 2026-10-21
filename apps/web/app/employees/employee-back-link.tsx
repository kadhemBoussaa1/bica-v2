"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTRPC } from "../trpc/client";
import { statusOf } from "./employee-ui";

/**
 * The record page's way back, to the view that lists the record: a
 * suspended or archived one is not on `/employees`, so going back there
 * would lose it. The main list until the record loads — the same query as
 * the page below, so it costs no second request.
 */
export function EmployeeBackLink({ id, className }: { id: string; className?: string }) {
  const t = useTranslations("employees");
  const trpc = useTRPC();
  const { data } = useQuery(trpc.employee.byId.queryOptions({ id }));
  const status = data ? statusOf(data) : "onRoster";

  if (status === "onRoster") {
    return (
      <Link className={className} href="/employees">
        {t("back")}
      </Link>
    );
  }
  return (
    <Link
      className={className}
      href={status === "archived" ? "/employees/suspended?filter=archived" : "/employees/suspended"}
    >
      {t("backToOff")}
    </Link>
  );
}
