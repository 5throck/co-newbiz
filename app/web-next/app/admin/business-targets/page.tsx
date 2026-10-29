import { redirect } from "next/navigation";

// ADR-0191: business-target standards moved from the admin console to the
// group screen (/our-company). Old bookmarks land there.
export default function AdminBusinessTargetsRedirect() {
  redirect("/our-company");
}
