# CLAUDE.md

Guidance for AI assistants (Claude Code and similar) working in this repository.

## Current state of the repository

As of 2026-10-31 this repository (`obopd/APP-Design`) is **empty**: this file is
the first commit. There is no source code, build tooling, dependency manifest,
test suite, or CI configuration yet.

Consequences for assistants:

- Do **not** assume a language, framework, package manager, or directory layout.
  Ask the user, or infer from files once they exist.
- Do not invent build/test/lint commands. Document real ones below once they are
  added to the repo.
- When the first real code lands, update this file (see "Keeping this file current").

## Codebase structure

_Not yet established._ When adding the initial project scaffold, record here:

- Top-level directories and what each contains
- Entry points (e.g. app root, main screens/routes)
- Where shared components, styles/design tokens, and assets live
- Where tests live and how they map to source files

## Development workflow

_Not yet established._ Once tooling exists, list the exact commands for:

| Task              | Command |
| ----------------- | ------- |
| Install deps      | TBD     |
| Run dev server    | TBD     |
| Build             | TBD     |
| Test              | TBD     |
| Lint / format     | TBD     |
| Type-check        | TBD     |

Run the relevant checks before committing whenever they exist.

## Git conventions

- Do work on a feature branch; never push directly to the default branch without
  explicit permission.
- Write clear, descriptive commit messages (imperative mood summary line,
  optional body explaining *why*).
- Keep commits focused; don't mix unrelated changes.
- Push with `git push -u origin <branch-name>`.
- Do not open pull requests unless the user asks for one.

## Coding conventions

_Not yet established._ Until the project defines its own, follow these defaults:

- Match the style, naming, and idioms of surrounding code.
- Prefer small, readable modules over large files.
- Don't commit secrets, credentials, `.env` files, or build artifacts.
- Add or update tests alongside behavior changes once a test suite exists.

## Keeping this file current

Update CLAUDE.md in the same change whenever you:

- Add the initial scaffold or change the directory layout
- Add/change build, test, lint, or run commands
- Introduce a new convention (naming, state management, styling approach, etc.)
- Add CI, deployment, or environment-variable requirements

Replace the "_Not yet established_" placeholders with concrete facts. Never
document commands or structure that don't actually exist in the repo.
