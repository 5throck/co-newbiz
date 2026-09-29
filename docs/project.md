# co-newbiz — Project Overview

> This file is project-owned identity: edit freely after creation. The upgrade
> pipeline seeds `docs/project.md` only when it is missing and never overwrites
> it. `docs/context.md` points here for the one-sentence description and type.

## Project Overview

- **Description**: AI-agent team and system for new-business review (Green Field and Brown Field/M&A) that owns the governance documents, implements them as a system, and runs deal reviews for human reviewers and approvers.
- **Type**: web (Next.js app in `app/web-next`; also ships an MCP server at `mcp/co-newbiz/index.ts`, configured in `.mcp.json`)
- **Status**: Active development

---

*Fill `Description` and `Type` at creation time (`bun scripts/new-project.ts "<name>" --description "<one sentence>" --type web|cli|api|mcp`) or by hand. Nothing here requires workspace-root context, and the upgrade flow never overwrites this file.*
