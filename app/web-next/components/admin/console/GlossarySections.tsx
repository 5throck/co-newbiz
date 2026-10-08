"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import type { AdminConsoleState } from "./useAdminActions.ts";

export function GlossaryListPanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, glossary } = ctx;
  return (
    <>{section === "glossary" &&
        (glossary === null ? (
          <p>불러오는 중...</p>
        ) : glossary.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 용어가 없습니다.</p>
        ) : (
          <table className="data-table">
            <caption className="sr-only">용어집 용어 목록</caption>
            <thead>
              <tr>
                <th scope="col">키</th>
                <th scope="col">한글</th>
                <th scope="col">영문</th>
                <th scope="col">분류</th>
              </tr>
            </thead>
            <tbody>
              {glossary.map((t) => (
                <tr key={t.key}>
                  <td className="font-mono text-xs">{t.key}</td>
                  <td>{t.ko}</td>
                  <td>{t.en}</td>
                  <td>{t.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}</>
  );
}

export function GlossaryLintPanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, lintQueue } = ctx;
  return (
    <>{section === "glossary" && (
        <div className="glossary-lint-queue mt-6">
          <h3>미정의어 큐 (glossary-lint)</h3>
          {lintQueue === null ? (
            <p>스캔 중...</p>
          ) : lintQueue.undefined.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">
              미정의 약어 없음 — {lintQueue.scanned_files}개 파일 스캔, 등록 용어 {lintQueue.known_count}개 사용 확인.
            </p>
          ) : (
            <>
              <p className="helper-note">
                {lintQueue.scanned_files}개 파일 스캔 · 등록 용어 {lintQueue.known_count}개 사용 · 미정의 후보 {lintQueue.undefined.length}건 — 큐레이터 심사 대상이며 자동 진행이 아닙니다.
              </p>
              <table className="data-table">
                <caption className="sr-only">미정의어 큐</caption>
                <thead>
                  <tr>
                    <th scope="col">토큰</th>
                    <th scope="col">파일</th>
                    <th scope="col">줄</th>
                    <th scope="col">빈도</th>
                  </tr>
                </thead>
                <tbody>
                  {lintQueue.undefined.map((u, i) => (
                    <tr key={`${u.token}-${u.file}-${u.line}-${i}`}>
                      <td className="font-mono text-xs">{u.token}</td>
                      <td className="font-mono text-xs">{u.file}</td>
                      <td>{u.line}</td>
                      <td>{u.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}</>
  );
}

export function GlossaryFormPanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, submitGlossaryTerm, termForm, setTermForm, termFormError, termFormNotice, termFormBusy } = ctx;
  return (
    <>{section === "glossary" && (
        <form className="glossary-form mt-6" onSubmit={submitGlossaryTerm} aria-label="용어 등록">
          <h3>용어 등록</h3>
          <p className="helper-note">
            why_it_matters_ko는 필수입니다 — 정의만으로는 이 프로젝트에서 &quot;왜 중요한가&quot;가 전달되지 않습니다 (glossary/_schema.yaml).
          </p>
          <div className="form-grid">
            <label>
              키 *
              <input type="text" value={termForm.key} onChange={(e) => setTermForm({ ...termForm, key: e.target.value })} required />
            </label>
            <label>
              한글 용어 *
              <input type="text" value={termForm.ko} onChange={(e) => setTermForm({ ...termForm, ko: e.target.value })} required />
            </label>
            <label>
              영문 용어 *
              <input type="text" value={termForm.en} onChange={(e) => setTermForm({ ...termForm, en: e.target.value })} required />
            </label>
            <label>
              분류 *
              <select value={termForm.category} onChange={(e) => setTermForm({ ...termForm, category: e.target.value })}>
                <option value="business">business</option>
                <option value="financial">financial</option>
                <option value="legal">legal</option>
                <option value="technical">technical</option>
                <option value="industry">industry</option>
                <option value="unit">unit</option>
              </select>
            </label>
            <label>
              소유 에이전트
              <input type="text" value={termForm.owner} onChange={(e) => setTermForm({ ...termForm, owner: e.target.value })} />
            </label>
            <label>
              별칭 (쉼표 구분)
              <input type="text" value={termForm.aliases} onChange={(e) => setTermForm({ ...termForm, aliases: e.target.value })} />
            </label>
          </div>
          <label className="block mt-2">
            정의 (definition_ko) *
            <textarea value={termForm.definition_ko} onChange={(e) => setTermForm({ ...termForm, definition_ko: e.target.value })} rows={2} required />
          </label>
          <label className="block mt-2">
            왜 중요한가 (why_it_matters_ko) *
            <textarea value={termForm.why_it_matters_ko} onChange={(e) => setTermForm({ ...termForm, why_it_matters_ko: e.target.value })} rows={2} required />
          </label>
          {termFormError && <p className="form-error mt-2" role="alert">{termFormError}</p>}
          {termFormNotice && <p className="form-success mt-2">{termFormNotice}</p>}
          <button type="submit" className="btn-ghost mt-2" disabled={termFormBusy}>
            {termFormBusy ? "등록 중..." : "용어 등록"}
          </button>
        </form>
      )}</>
  );
}
