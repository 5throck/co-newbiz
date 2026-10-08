import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminGuard } from "../../components/AdminGuard.tsx";

// Sub-routes override this title (R2-C page contract).
export const metadata: Metadata = { title: "관리자 콘솔" };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
