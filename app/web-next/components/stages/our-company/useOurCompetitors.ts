"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useCallback, useEffect } from "react";
import { api } from "../../../lib/api.ts";
import type { useOurCompanyBase } from "./useOurCompanyBase.ts";
import type { CompetitorRowView, CompetitorProposalView, WebSuggestionView } from "./types.ts";
import { useTranslations } from "next-intl";

export function useOurCompetitors(prev: ReturnType<typeof useOurCompanyBase>) {const t = useTranslations("components.ourCompany.useOurCompetitors");
  const { setCompetitors, setCompetitorProposals, openMember, setDismissedProposals, setExcludingCompetitor, setEditingCompetitor, compBusy, setCompBusy, setCompError, webBusy, setWebBusy, setWebSuggestions, setWebNote, competitorForm, setCompetitorForm, setCompetitorDartResults, competitorDartSearching, setCompetitorDartSearching, excludingCompetitor, editingCompetitor } = prev;


  // ── 경쟁사 레지스트리 액션 (ADR-0142) ──────────────────────────────
  const loadCompetitors = useCallback((memberId: string) => {
    api.get<{ competitors: CompetitorRowView[] }>(`/api/our-company/members/${encodeURIComponent(memberId)}/competitors`)
      .then((r) => setCompetitors(r.data.competitors)).catch(() => setCompetitors([]));
    api.get<{ proposals: CompetitorProposalView[] }>(`/api/our-company/members/${encodeURIComponent(memberId)}/competitor-proposals`)
      .then((r) => setCompetitorProposals(r.data.proposals)).catch(() => setCompetitorProposals([]));
  }, []);

  useEffect(() => {
    if (!openMember) return;
    setDismissedProposals([]);
    setExcludingCompetitor(null);
    setEditingCompetitor(null);
    loadCompetitors(openMember);
  }, [openMember, loadCompetitors]);

  async function acceptProposal(name: string) {
    if (!openMember || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors`, { name, discovery_source: "ai_proposal" });
      setDismissedProposals((prev) => [...prev, name]);
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : t("failedToAcceptTheCompetitor"));
    } finally {
      setCompBusy(false);
    }
  }

  async function runCompetitorWebSearch() {
    if (!openMember || webBusy) return;
    setWebBusy(true); setCompError(null);
    try {
      const r = await api.post<{ source: "llm" | "llm_knowledge"; note: string; suggestions: WebSuggestionView[] }>(`/api/our-company/members/${encodeURIComponent(openMember)}/competitor-proposals/web-search`, {});
      setWebSuggestions(r.data.suggestions ?? []);
      setWebNote(r.data.note ?? null);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : t("failedToViaWebSearch"));
    } finally {
      setWebBusy(false);
    }
  }

  async function acceptWebSuggestion(ws: WebSuggestionView) {
    if (!openMember || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors`, {
        name: ws.name,
        note: ws.note || null,
        discovery_source: "ai_proposal",
        evidence: ws.sources.map((s) => ({ title: s.title, url: s.url })),
      });
      setWebSuggestions((prev) => (prev ?? []).filter((x) => x.name !== ws.name));
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : t("failedToAcceptTheCompetitor2"));
    } finally {
      setCompBusy(false);
    }
  }

  async function registerManualCompetitor() {
    if (!openMember || compBusy || !competitorForm.name.trim()) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors`, {
        name: competitorForm.name,
        dart_corp_code: competitorForm.dart_corp_code || null,
        note: competitorForm.note || null,
        discovery_source: "manual",
      });
      setCompetitorForm({ name: "", dart_corp_code: "", note: "" });
      setCompetitorDartResults([]);
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : t("failedToRegisterTheCompetitor"));
    } finally {
      setCompBusy(false);
    }
  }

  async function searchCompetitorDart() {
    const q = competitorForm.name.trim();
    if (!q || competitorDartSearching) return;
    setCompetitorDartSearching(true); setCompError(null);
    try {
      const res = await api.get<{ configured: boolean; results: Array<{ corp_code: string; corp_name: string; source?: string; validated?: boolean | null }>; error?: string }>(`/api/synergy/dart-search?q=${encodeURIComponent(q)}`);
      setCompetitorDartResults(res.data.results ?? []);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : t("dartSearchFailed"));
    } finally {
      setCompetitorDartSearching(false);
    }
  }

  async function saveCompetitorExclude() {
    if (!openMember || !excludingCompetitor?.reason.trim() || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors/${encodeURIComponent(excludingCompetitor.id)}/exclude`, { reason: excludingCompetitor.reason.trim() });
      setExcludingCompetitor(null);
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : t("failedToExcludeTheCompetitor"));
    } finally {
      setCompBusy(false);
    }
  }

  async function restoreCompetitorRow(id: string) {
    if (!openMember || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.post(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors/${encodeURIComponent(id)}/restore`, {});
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : t("failedToRestoreTheCompetitor"));
    } finally {
      setCompBusy(false);
    }
  }

  async function saveCompetitorEdit() {
    if (!openMember || !editingCompetitor || compBusy) return;
    setCompBusy(true); setCompError(null);
    try {
      await api.patch(`/api/our-company/members/${encodeURIComponent(openMember)}/competitors/${encodeURIComponent(editingCompetitor.id)}`, {
        note: editingCompetitor.note || null,
        dart_corp_code: editingCompetitor.dart || null,
      });
      setEditingCompetitor(null);
      loadCompetitors(openMember);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : t("failedToUpdateTheCompetitor"));
    } finally {
      setCompBusy(false);
    }
  }
  return { saveCompetitorEdit, saveCompetitorExclude, restoreCompetitorRow, runCompetitorWebSearch, acceptProposal, acceptWebSuggestion, searchCompetitorDart, registerManualCompetitor };
}
