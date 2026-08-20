import type { ResolvedProcedure } from "../api.ts";

// Procedure viewer — ui-spec.md §4. Renders proc:resolve's merged result
// with a per-step source badge (공통/지역/각사) so an override is always
// visually traceable back to which layer introduced it.

const SOURCE_LABEL: Record<string, string> = {
  shared: "공통",
  region: "지역",
  entity: "각사",
};

export function ProcedureViewer({ procedure }: { procedure: ResolvedProcedure }) {
  return (
    <div className="procedure-viewer">
      <p className="procedure-layers">
        적용 계층: {procedure.layersApplied.join(" → ")}
      </p>
      <ol className="procedure-steps">
        {procedure.steps.map((step) => (
          <li key={step.id} className="procedure-step">
            <span className={`source-badge source-${step._source}`}>{SOURCE_LABEL[step._source] ?? step._source}</span>
            <span className="procedure-step-body">
              <strong>{step.id}.</strong> ({step.gate}) {step.agent_key} / {step.skill_key} → {step.output_type}
            </span>
          </li>
        ))}
      </ol>
      {Object.keys(procedure.thresholds).length > 0 && (
        <div className="procedure-thresholds">
          <h3>임계값</h3>
          <dl>
            {Object.entries(procedure.thresholds).map(([k, v]) => (
              <div key={k} className="threshold-row">
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
