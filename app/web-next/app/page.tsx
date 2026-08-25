import { redirect } from "next/navigation";

// Port of App.tsx's <Route path="/" element={<Navigate to="/projects" />} />
export default function RootPage() {
  redirect("/projects");
}
