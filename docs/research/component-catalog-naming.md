---
lang: en
counterpart: component-catalog-naming_ko.md
---

# Research Note — Component Catalog and Naming Standard Practices

> 🌐 External reference material. Researched: 2026-09-05. For comparing industry practices in how major component catalogs are documented.

## Standard Practices

1. **Atomic Design structure is still widely used**: atoms (buttons·icons·inputs) → molecules (input groups·
   list items) → organisms (navigation bars·cards) → templates (layout skeletons) → pages — especially
   useful for file/folder organization
2. **The 2026 trend is a shift from the "chemistry metaphor" to "semantic naming"**: instead of abstract
   classifications like atom/molecule/organism, purpose-based naming — where the name itself conveys what
   a component does and where it is used — is spreading. A hybrid that separates structural hierarchy into
   folder structure while keeping actual usage names semantic is the mainstream approach
3. **Naming convention examples**: prefix-based (`btn-`, `card-`, `nav-`), BEM (Block-Element-Modifier),
   or, like the CFPB Design System, adding `a-` (atom) / `m-` (molecule) / `o-` (organism) / `u-` (utility)
   prefixes to CSS classes
4. **Catalog documentation checklist**: every UI element must be traceable to a single atom (no raw markup
   in organisms·templates), components must reference design tokens, one responsibility per component,
   and the hierarchy must be documented or self-evident from the directory structure
5. **Token-component linkage**: token naming must be clear and consistent so there is less confusion about
   what components reference — the component catalog and the token catalog should not be separate documents
   but should cross-reference each other

## co-newbiz mapping

- The current component catalog (StageFrame, ProjectSubNav, GateDecisionPanel, CommitteePanel, etc.)
  already follows functional-purpose naming (semantic), aligning with the 2026 industry trend.
- The rule "every new detail screen must include ProjectSubNav (orphan screens forbidden)" points in the
  same direction as the catalog documentation checklist principle that "every UI element must be traceable
  to a single standard component."
- The data-table header/cell alignment rules and the single list-return pattern (ListBackButton) are
  concrete instances of the "single responsibility per component + global reuse" principle.

## Sources

- CFPB Design System, "Atomic components" — https://cfpb.github.io/design-system/development/atomic-components (accessed 2026-09-05)
- Namastedev, "Design Systems 101: Tokens, Components, and Documentation" — https://namastedev.com/blog/design-systems-101-tokens-components-and-documentation/ (accessed 2026-09-05)
- UX Design Bootcamp (Medium), "A guide to naming components on Design System effectively" — https://bootcamp.uxdesign.cc/a-guide-for-naming-components-on-design-system-effectively-7c32f76861a9 (accessed 2026-09-05)
