// @version 1.0.0
/** Helpers over the analyst-supplied source list stored in a profile payload (dataSources.userSources). */
import type { CompanyProfilePayload } from "./company-profile-pipeline.ts";
import type { UserSourceRecord } from "./safe-fetch-text.ts";

/** Entries that still count as evidence (soft-removed slots are skipped). */
export function activeUserSources(profile: Pick<CompanyProfilePayload, "dataSources"> | null | undefined): UserSourceRecord[] {
  return (profile?.dataSources?.userSources ?? []).filter((x) => !x.removed);
}

/** A note or a source with a real body backs claims; URL-only/thin/failed entries cannot. */
export function hasUsableAnalystEvidence(profile: Pick<CompanyProfilePayload, "dataSources"> | null | undefined): boolean {
  return Boolean(profile?.dataSources?.analystNote) || activeUserSources(profile).some((x) => x.status === "ok");
}
