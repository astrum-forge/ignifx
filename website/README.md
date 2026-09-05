# ignifx.com (website)

Public site for ignifx. Planned as a plain Vite + TypeScript single-page application, hosted separately from the engine packages (own deploy workflow `website.yml`). Visual design is deferred by decision; Phase 0 of the engineering plan creates the shell (including a placeholder `public/llms.txt`), Phase 11 populates `public/llms.txt` for agents, and Phase 12 adds content (features, getting started, docs links, gallery).

Not a workspace package that is published; it consumes `@ignifx/*` from the workspace for live demos once those exist.
