# `titen-memory@0.4.1` replacement hard-gate report

- Decision: **NO-GO for replacing authoritative Mem0 with `0.4.1`**
- Evaluated package: `titen-memory@0.4.1`
- npm SHA-1: `8928a08db8f8f099a81bfa672baffad7b2e33fcd`
- npm integrity: `sha512-5bN+X/TbxUgyVKW0vQ8WXEwof7uVk8sbKpmTKpt6Qh6suU513h8y6cTBV/IsHzbtxxy8iboKhEjtu4qf6OwK9w==`
- downloaded tarball SHA-256: `df80143647c5608930ed65cb78fb7cfb4f39f5ebe922af6b8e4ca3cde91fab46`
- annotated tag: `v0.4.1`
- release commit: `88935bac871811066692c1d149df030ab694862d`
- authority after evaluation: Mem0 unchanged and authoritative

## Hard-gate outcomes

Independent exact-package negative probes reproduced four correctness failures:

1. revoking an unknown key exits successfully and reports `revoked` although no
   row changed (#208);
2. local key creation for an unknown organization emits raw SQLite/Bun runtime
   details instead of a bounded domain error (#209);
3. key list and revoke against missing paths create SQLite files and emit raw
   runtime diagnostics (#210);
4. context compilation can omit every authorized candidate under token pressure
   without saying that the empty pack was caused by budget exhaustion (#212).

The first three violate the pre-registered security/operability bar; the fourth
makes no-result and replacement measurements ambiguous. A source correction
after publication cannot alter the frozen `0.4.1` result.

## Deliberately stopped work

Ponytail stops the expensive side-by-side performance, resource, migration,
canary, and soak lanes at this failed hard gate. Measuring speed after a known
correctness regression cannot produce an acceptable replacement decision.
Those lanes may be run against a separately frozen successor release after its
negative-path regression suite passes; they are not credited to `0.4.1`.

## Reproduction boundary

The probes used temporary databases and generated identifiers only. They did not
read or change production Mem0 data, credentials, routing, configuration, or
authority. Registry identity was re-read on 2026-08-01 and the tarball was
downloaded through `npm pack titen-memory@0.4.1` before hashing.

## Terminal disposition

Close issue #211 as a checksummed release-bound **NO-GO**. Fixes belong to a new
semantic version and may justify a new evaluation, but must not rewrite this
historical verdict or imply that a future release is automatically approved for
cutover.
