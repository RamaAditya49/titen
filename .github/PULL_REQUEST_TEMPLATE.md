## Problem

<!-- What user or system problem does this change solve? -->

## Solution

<!-- What is the smallest solution and why is it sufficient? -->

## Impact

- Runtime(s): <!-- Cloudflare / VPS / shared / docs -->
- Security or data migration: <!-- none or explain -->
- API compatibility: <!-- compatible or explain -->
- Release impact: <!-- none / patch / minor while below 1.0.0 -->

## Changelog and README

- Changelog: <!-- updated under Unreleased / not needed because ... -->
- README: <!-- updated / not needed because ... -->
- Detailed docs: <!-- paths updated / observable behavior unchanged -->

## Workflow

- Classification: <!-- simple / complex -->
- Spec: <!-- inline or docs/specs/... -->
- Plan: <!-- inline or docs/plans/... -->
- Terminal outcome: <!-- completed / cancelled / superseded -->

## Verification

<!-- Commands, tests, and manual/runtime smoke evidence. -->

## Checklist

- [ ] Change is scoped to one logical concern.
- [ ] Branch was rebased onto current `origin/main` before final review.
- [ ] Pull request title is a valid Conventional Commit squash subject.
- [ ] The change followed `spec -> plan -> implement -> done`.
- [ ] Complex work has paired EARS spec/plan artifacts under `done/` before this
      pull request is marked complete.
- [ ] Every acceptance ID has reproducible evidence and no plan item is left
      unchecked.
- [ ] Non-trivial behavior has a regression or contract test.
- [ ] Cross-scope authorization was considered.
- [ ] Documentation matches observable behavior.
- [ ] Release impact is classified; ordinary work does not bump the package or
      create a tag.
- [ ] Notable user-facing work updates `CHANGELOG.md` under `Unreleased`.
- [ ] `README.md` and `docs/README.md` are aligned when public usage or current
      implementation status changes.
- [ ] No credentials or private memory data are included.
- [ ] Rollback/compatibility impact is documented when relevant.
