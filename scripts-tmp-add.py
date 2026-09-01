# add new routes to openapi.yaml (skip paths already present)
import io, re

p = "docs/openapi.yaml"
s = io.open(p, encoding="utf-8").read()

existing = set(re.findall(r"^  (/api/[^:]+):", s, re.M))

def route(method, path, opid, summary):
    return (
        f"  {path}:\n"
        f"    {method}:\n"
        f"      operationId: {opid}\n"
        f"      summary: {summary}\n"
        f"      tags: [Analysis]\n"
        f'      responses:\n        "200": {{ $ref: "#/components/responses/Ok" }}\n'
        f'        "401": {{ $ref: "#/components/responses/Unauthorized" }}\n'
    )

defs = [
    ("get", "/api/llm-status", "getLlmStatus", "LLM provider configuration status (configured/provider/model — never the key). Any authenticated role."),
    ("post", "/api/market-overview/analyses", "createMarketAnalysis", "Create a new industry market-sizing analysis (analyst+)."),
    ("get", "/api/market-overview/analyses", "listMarketAnalyses", "List market-sizing analyses."),
    ("get", "/api/market-overview/analyses/{id}", "getMarketAnalysis", "Market-sizing analysis detail with version history."),
    ("post", "/api/market-overview/analyses/{id}/rerun", "rerunMarketAnalysis", "Re-run an analysis (append-only version N+1)."),
    ("get", "/api/market-overview/industry/{industryId}", "getMarketIndustry", "Industry detail — chain links, driver sensitivities, simulations, versions."),
    ("patch", "/api/market-overview/industry/{industryId}", "updateMarketIndustry", "Update industry name/KSIC (analyst+)."),
    ("delete", "/api/market-overview/industry/{industryId}", "deleteMarketIndustry", "Delete industry + its market-sizing analyses (analyst+; 409 when referenced)."),
    ("get", "/api/market-overview/insights", "getMarketInsights", "Completed-analysis insights for the S2 bridge."),
    ("post", "/api/synergy/analyses", "createSynergyAnalysis", "Create a synergy analysis for a target company (analyst+)."),
    ("get", "/api/synergy/analyses", "listSynergyAnalyses", "List synergy analyses."),
    ("get", "/api/synergy/analyses/{id}", "getSynergyAnalysis", "Synergy analysis detail with version history."),
    ("get", "/api/synergy/dart-search", "searchDartCompanies", "DART company search (corp code auto-fill)."),
    ("post", "/api/synergy/upload", "uploadEvidenceFile", "Upload credit-report/evidence file; extracts text (PDF/txt)."),
    ("get", "/api/synergy/web-search", "webSearchCompany", "External web research for a company (TAVILY)."),
    ("post", "/api/opportunities/discover", "discoverOpportunities", "Derive opportunity candidates from a completed market analysis (analyst+)."),
    ("get", "/api/opportunities/{id}/route-decision", "getRouteDecision", "Route decisions for an opportunity."),
    ("post", "/api/opportunities/{id}/route-decision", "createRouteDecision", "Record track (GF/BF) + Brownfield route decision (S4, selected opportunity only)."),
    ("get", "/api/opportunities/{id}/factors", "getOpportunityFactors", "Opportunity/risk factors for an opportunity."),
    ("post", "/api/opportunities/{id}/factors", "deriveOpportunityFactors", "Auto-derive opportunity/risk factors (analyst+)."),
    ("put", "/api/opportunities/{id}/factors", "addOpportunityFactor", "Add a manual opportunity/risk factor."),
    ("delete", "/api/opportunities/{id}/factors", "deleteOpportunityFactor", "Remove a factor by type+index."),
    ("post", "/api/opportunities/{id}/sketch", "createBusinessModelSketch", "Generate/persist a business-model sketch (analyst+)."),
    ("get", "/api/opportunities/{id}/screening", "getOpportunityScreening", "S3 screening state (synergy, fit, gate recommendation)."),
    ("post", "/api/opportunities/{id}/screening", "runOpportunityScreening", "Run synergy analysis or strategic-fit verdict (S3)."),
    ("get", "/api/our-company/groups", "listCompanyGroups", "List groups (affiliate counts)."),
    ("post", "/api/our-company/groups", "createCompanyGroup", "Create a group (analyst+)."),
    ("get", "/api/our-company/groups/{id}", "getCompanyGroup", "Group detail with members and latest profiles."),
    ("post", "/api/our-company/groups/{id}/members", "addGroupMember", "Add an affiliate/HQ to a group."),
    ("delete", "/api/our-company/groups/{id}/members", "removeGroupMember", "Remove an affiliate + its profiles."),
    ("patch", "/api/our-company/groups/{id}/members", "updateGroupMember", "Update member DART code/role."),
    ("post", "/api/our-company/members/{memberId}/analyze", "analyzeMember", "Run the company-profile pipeline (versioned)."),
    ("get", "/api/our-company/members/{memberId}/profile", "getMemberProfile", "Member profile + version history."),
    ("get", "/api/brownfield", "listBrownfieldOpportunities", "Opportunities with a Brownfield route decision."),
    ("get", "/api/brownfield/{oppId}/targets", "listBrownfieldTargets", "Long List + checklist definition + screening summaries."),
    ("post", "/api/brownfield/{oppId}/targets", "addBrownfieldTarget", "Add a Long List target candidate."),
    ("patch", "/api/brownfield/{oppId}/targets/{targetId}", "updateBrownfieldTarget", "Update target company/DART/universe note."),
    ("post", "/api/brownfield/{oppId}/targets/{targetId}", "saveTargetScreening", "Save chk-target-screening verdicts."),
    ("post", "/api/brownfield/{oppId}/targets/{targetId}/shortlist", "shortlistTarget", "Promote to Short List (knock-out + mandatory pass required)."),
    ("post", "/api/brownfield/{oppId}/targets/{targetId}/exclude", "excludeTarget", "Exclude with exclusion reason."),
    ("get", "/api/greenfield", "listGreenfieldOpportunities", "Opportunities with a Greenfield route decision."),
    ("get", "/api/greenfield/{oppId}", "getGreenfieldAssessment", "Greenfield capability assessment state."),
    ("post", "/api/greenfield/{oppId}", "saveGreenfieldAssessment", "Save capability gaps / entry strategy / business-case lines."),
]

block = "\n".join(route(m, pth, op, sm) for m, pth, op, sm in defs if pth not in existing)
idx = s.index("\ncomponents:")
s = s[:idx] + "\n" + block + s[idx:]
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("added", len([d for d in defs if d[1] not in existing]))
PYEOF