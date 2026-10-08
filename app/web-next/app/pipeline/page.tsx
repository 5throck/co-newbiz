import { redirect } from "next/navigation";

// Wave 4 redirect sweep (ADR-0120): the /pipeline screen was subsumed by the
// /deals board (funnel + gate aging in one). Server-side redirect so old
// links and bookmarks never break. R2-A item 8: the redirect carries
// `?moved=pipeline` so the board explains where the person landed.
export default function PipelineRedirect() {
  redirect("/deals?moved=pipeline");
}
