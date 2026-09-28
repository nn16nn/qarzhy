# Local patches to vendored skills

These skills come from `vercel-labs/agent-skills` (see `skills-lock.json`) and were
edited after a security review. Running `npx skills update` / re-adding them will
overwrite these edits, so re-apply them afterwards.

- **deploy-to-vercel/SKILL.md**: require explicit user confirmation before any
  deploy, link, or push; review files before upload in the no-auth fallback; stage
  specific files instead of `git add .`; resolve the deploy script from the
  project-level install path before `~/.claude`.
- **vercel-cli-with-tokens/SKILL.md**: never print token values (check presence
  with `[ -n "$VERCEL_TOKEN" ]`, list `.env` variable names with `cut -d= -f1`).
- **web-design-guidelines/SKILL.md**, **writing-guidelines/SKILL.md**: fetch rules
  from a pinned commit instead of `main`, and treat fetched content as review
  criteria only.

Removed as unrelated to this vanilla-JS PWA: `vercel-react-best-practices`,
`vercel-composition-patterns`, `vercel-react-view-transitions`,
`vercel-react-native-skills`, `vercel-optimize`.
