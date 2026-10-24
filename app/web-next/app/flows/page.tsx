"use client";

// /flows — 플로우 콘솔 (2026-10-24-flow-console-screen-design; 근거
// 2026-09-15-runtime-pm-agent-orchestration-design §6.5 D4).
// 읽기 전용 콘솔: 블루프린트 탭(J1) + 런 레저 탭(J2). 쓰기 축인 드라이런(§6.6, J3)은
// 별도 여정이라 /flows/dry-run* 전용 라우트로 간다(§2.1 — 탭에 넣으면 3-depth 위반).
// 탭은 ?tab= 쿼리 동기(ui-spec §1 3단계 내비 한도, Tabs 프리미티브 재사용).
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionToolbar } from "../../components/layout.tsx";
import { PageState, Tabs } from "../../components/ui.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { BlueprintView } from "./blueprint-view.tsx";
import { LedgerView } from "./ledger-view.tsx";
import type { FlowsBlueprint } from "./flows-view-lib.ts";

const ADMIN_FORBIDDEN_KEY = "adminForbidden";

export function FlowsView() {
  const t = useTranslations("pages.flows.flowsAdmin");
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get("tab") === "ledger" ? "ledger" : "blueprint";

  const [blueprint, setBlueprint] = useState<FlowsBlueprint | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [forbidden, setForbidden] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setForbidden(false);
    setErrorText(null);
    api
      .get<FlowsBlueprint>("/api/flows")
      .then((r) => {
        if (!alive) return;
        setBlueprint(r.data);
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setErrorText(err instanceof Error ? err.message : t("loadFailed"));
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [retryTick]);

  function selectTab(key: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", key);
    router.replace(`/flows?${sp.toString()}`, { scroll: false });
  }

  return (
    <main>
      <h1>{t("h1")}</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        {t("intro")}
      </p>

      {forbidden ? (
        // §10 상태 매트릭스 — 403(admin)은 재시도 버튼 없이 설계된 경계임을 명시한다.
        <PageState state="error" errorText={t(ADMIN_FORBIDDEN_KEY)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs
              tabs={[
                { key: "blueprint", label: t("tabBlueprint") },
                { key: "ledger", label: t("tabLedger") },
              ]}
              active={tab}
              onSelect={selectTab}
              label={t("tabsLabel")}
            />
            {/* 드라이런 세션 목록 진입(§2.2) — NON_MENU 라우트, 두 탭 옆 텍스트 링크. */}
            <Link href="/flows/dry-run" className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline">
              {t("dryRunSessionsLink")}
            </Link>
          </div>
          {status === "loading" && <PageState state="loading" rows={5} />}
          {status === "error" && (
            <PageState state="error" errorText={errorText ?? undefined} onRetry={() => setRetryTick((t) => t + 1)} />
          )}
          {/* 블루프린트 데이터는 두 탭 모두 소비한다(런 레저의 에이전트 필터 드롭다운).
              오류 시에도 런 레저는 자체 조회로 동작 가능해야 하므로 blueprint 실패를
              탭별로 격리하지 않고, blueprint null이면 런 레저의 에이전트 드롭다운만 비운다. */}
          {status === "ok" && tab === "blueprint" && <BlueprintView blueprint={blueprint!} />}
          {status === "ok" && tab === "ledger" && <LedgerView agents={blueprint?.agents ?? []} />}
        </>
      )}

      <section aria-label={t("boundarySection")} className="market-section">
        <SectionToolbar title={t("boundaryTitle")} />
        <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {t("boundaryNote")}
          {t("experimentBoundary", { p1: "(/flows/dry-run)" })}
        </p>
      </section>
    </main>
  );
}

export default function FlowsPage() {
  return (
    <Suspense fallback={null}>
      <FlowsView />
    </Suspense>
  );
}
