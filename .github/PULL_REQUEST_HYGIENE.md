# Repo hygiene: scratch area and planning discipline

## Goal

Eliminate untracked noise and make it hard for planning drafts or local artifacts to leak into feature PRs.

## Scope (strict)

This PR is about repository hygiene only. No behavior, strategy, or feature changes.

## What changed

- **scratch/**  
  Added a tracked directory with contents gitignored. Use it for WIP planning and local artifacts so they don’t show up as untracked in normal work. `.gitkeep` keeps the directory in the repo; everything else in `scratch/` is ignored.

- **.gitignore**  
  Updated to ignore `scratch/*` while keeping `scratch/.gitkeep`, with a short comment.

## What to keep vs not commit (canonical)

**Keep and commit (already in repo or in this PR):**
- `.github/pull_request_template.md` – enforces discipline.
- `docs/agent-planning-prompt.md` – durable instruction source for coding agents (if you use it that way).
- `docs/plans/phase-3-post-merge-checklist.md` – intentional.

**Do not commit yet:**
- AGENTS.md if it is exploratory or incomplete.
- Phase drafts that are not approved (e.g. future phases).
- Cursor-local planning artifacts.

Put WIP and unapproved drafts in `scratch/`; they will stay local.

## Acceptance criteria

- [ ] `git status` is clean after normal work (no stray planning files).
- [ ] No planning drafts show up as untracked when working on feature PRs.
- [ ] PR template is enforced by default.
- [ ] No functional code changes.

This PR should be tiny and boring. That’s a feature.
