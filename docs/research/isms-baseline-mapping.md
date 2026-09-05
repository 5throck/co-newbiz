---
lang: en
counterpart: isms-baseline-mapping_ko.md
---

# Research Note — ISMS/ISO 27001 Mapping of the Security Baseline

> 🌐 External reference material. Researched: 2026-09-05. Reference for comparing the control items of docs/security/security-baseline.md from an international standards perspective.

## Standard Practices

1. **Risk assessment first**: it is not necessary to implement all 93 Annex A controls (2022 edition,
   4 themes: organizational·people·physical·technological); only controls selected and justified through
   risk assessment are entered in the SoA (Statement of Applicability) (ZipSec, GAICC)
2. **Auditable evidence·clear owners** are the common axis of practical checklists (ISMS.online 27 controls)
3. **Reuse framework mappings**: map SOC 2·NIST CSF controls to ISO 27001 to avoid dual implementation
   (Strike Graph)
4. **Small-team practice**: separate approach for management requirements (clauses 4–10) vs technical
   controls, and reuse of existing controls (Cyberday, Sprinto)

## co-newbiz mapping

- Tagging each security-baseline item with Annex A's 4 themes would allow conversion into an SoA draft
  when preparing for certification. Existing rules such as least-privilege roles and secret management map
  directly onto the technical controls axis.

## Sources

- ISMS.online, "ISO 27001 MSP Checklist: 27 Essential Controls" — https://www.isms.online/managed-service-providers/iso-27001-msp-checklist-27-essential-controls-every-provider-must-implement/ (accessed 2026-09-05)
- ZipSec, "ISO 27001 Controls: What to Deploy" — https://www.zipsec.com/blog/iso-27001-controls (accessed 2026-09-05)
- Strike Graph, "SOC 2 vs ISO 27001" — https://www.strikegraph.com/blog/difference-between-iso-27001-and-soc-2 (accessed 2026-09-05)
- Cyberday, "ISO 27001 Compliance & Certification Checklist" — https://www.cyberday.ai/blog/iso-27001-compliance-and-certification-checklist (accessed 2026-09-05)
