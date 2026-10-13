# legal-signoff

Counsel sign-off records for checklist items, one file per checklist version:
`legal-signoff/<checklist>@<version>.yaml`.

- Protocol and rules: [`docs/governance/legal-signoff-protocol.md`](../docs/governance/legal-signoff-protocol.md).
- Start from [`_template.yaml`](_template.yaml). Files starting with `_` are ignored by the validator.
- `bun checklists/_validate.ts` checks every file here: item ids exist in the named checklist, the verdict is
  confirm | revise | hold, signer, qualification, approver and date are present, and every checklist item with
  `review_status` counsel-reviewed or confirmed has a matching confirm entry.
- Currently empty: the signer is not yet named ("to be designated by the human decider"), so no item is counsel-reviewed.
- Decision support only; a sign-off is not a gate approval.
