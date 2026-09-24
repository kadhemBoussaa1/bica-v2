import { redirect } from "next/navigation";

/**
 * The module has no hub of its own any more: the rail beside every page is
 * the map, and a section is always open. The first one is the accounts,
 * which every role that reaches the module (ADMIN and above) can read.
 */
export default function SettingsPage() {
  redirect("/settings/users");
}
