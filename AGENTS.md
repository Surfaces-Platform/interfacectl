# Agent instructions

Read "docs/strategy.md" before planning or implementing any feature work.
Read "docs/taxonomy.md" and use its timing terms exactly.

For any feature work, produce a "Feature Plan" using "docs/feature-plan.template.md" and include it in the PR description or as a new file under "docs/plans/".

Do not proceed if you cannot clearly map the change to:
- contract definition or semantics
- enforcement timing (Generation time, CI/CD time, Runtime (edge), or a combination)
- violation handling

Before proposing code changes, ensure the plan explicitly states:
- which lifecycle context(s) the change affects
- which artifacts are used in each context
- which tools enforce decisions in each context

Repo-specific durability rules:
- this repo is the canonical source of truth for CLI behavior, validator logic, extractor behavior, schema, and release provenance
- the static preview files in `public/index.html` and `vercel.json` are repo-local preview infrastructure, not the primary product website
- the public onboarding and richer product marketing site still live in `../surfaces-webapps/apps/interfacectl-web`
- if a cross-repo task also requires consumer wiring, land and test the source change here first, then update `surfaces-webapps`
