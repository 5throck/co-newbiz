import { notFound } from "next/navigation";
import MockupClient from "./MockupClient.tsx";

// Review-only UX mockup route. Hidden in production unless explicitly enabled
// with CO_NEWBIZ_ENABLE_MOCKUP_ROUTES=1; development remains directly
// accessible for design review.
export default function BrownfieldMockupPage() {
  if (process.env.NODE_ENV === "production" && process.env.CO_NEWBIZ_ENABLE_MOCKUP_ROUTES !== "1") {
    notFound();
  }
  return <MockupClient />;
}
