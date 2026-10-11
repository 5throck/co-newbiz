"use client";

// 접근 불가 프로젝트 가드 (design 2026-10-11-ui-label-and-mobile-table-sweep §4):
// 프로젝트 프로세스 조회가 403/404이면 단계 외피(stage chrome) 없이 한국어
// not-found 상태를 렌더한다. 403과 404는 구분하지 않는다(존재 여부 누출 방지).
// 접근 가능한 프로젝트에서는 자식을 그대로 렌더한다(확인은 백그라운드 1회).
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api.ts";
import { ProjectNotFound } from "./ProjectNotFound.tsx";

export function ProjectAccessGuard({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api.get(`/api/projects/${encodeURIComponent(projectId)}/process`)
      .then(() => { if (alive) setDenied(false); })
      .catch((e) => {
        if (alive && e instanceof ApiError && (e.status === 403 || e.status === 404)) setDenied(true);
      });
    return () => { alive = false; };
  }, [projectId]);

  if (denied) return <ProjectNotFound />;
  return <>{children}</>;
}
