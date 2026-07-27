## Problem

<!-- What user or system problem does this change solve? -->

## Solution

<!-- What is the smallest solution and why is it sufficient? -->

## Impact

- Runtime(s): <!-- Cloudflare / VPS / shared / docs -->
- Security or data migration: <!-- none or explain -->
- API compatibility: <!-- compatible or explain -->

## Workflow

- Classification: <!-- simple / complex -->
- Spec: <!-- inline or docs/specs/... -->
- Plan: <!-- inline or docs/plans/... -->
- Terminal outcome: <!-- completed / cancelled / superseded -->

## Verification

<!-- Commands, tests, and manual/runtime smoke evidence. -->

## Checklist

- [ ] Change is scoped to one logical concern.
- [ ] The change followed `spec -> plan -> implement -> done`.
- [ ] Complex work has paired EARS spec/plan artifacts under `done/` before this
      pull request is marked complete.
- [ ] Every acceptance ID has reproducible evidence and no plan item is left
      unchecked.
- [ ] Non-trivial behavior has a regression or contract test.
- [ ] Cross-scope authorization was considered.
- [ ] Documentation matches observable behavior.
- [ ] No credentials or private memory data are included.
- [ ] Rollback/compatibility impact is documented when relevant.
