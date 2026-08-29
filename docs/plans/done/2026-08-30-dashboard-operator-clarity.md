---
work_id: dashboard-operator-clarity-20260830
status: done
stage: done
outcome: completed
complexity: complex
created: 2026-08-30
updated: 2026-08-30
owner: CADIS
spec: docs/specs/done/2026-08-30-dashboard-operator-clarity.md
---

# Dashboard Operator Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Check each step during execution.

**Goal:** Bangun tampilan operator yang spesifik untuk setiap area dashboard Titen.

**Architecture:** Pisahkan perender collection dari shell Astro. Gunakan konfigurasi field yang eksplisit untuk setiap area. Pertahankan API, capability gate, dan mutasi saat ini.

**Tech Stack:** Astro 7, TypeScript 5.9, native DOM, native CSS, Playwright 1.62, Node 24, pnpm 11, Bun, dan Cloudflare.

**Spec:** `docs/specs/done/2026-08-30-dashboard-operator-clarity.md`

## Global Constraints

- Gunakan adaptasi ASD-STE100 untuk teks Indonesia.
- Gunakan ASD-STE100 Issue 9 untuk teks teknis Inggris.
- Jangan ubah REST API, MCP API, SQL, atau migration.
- Jangan tambah dependency atau framework.
- Jangan simpan credential atau data privat dalam browser storage.
- Jangan tambah GitHub Actions atau deployment otomatis.
- Jaga bundle dashboard di bawah 80 KiB gzip.
- Tunda publikasi npm sampai Rama memberi persetujuan melalui browser.
- Akhiri setiap commit dengan trailer CADIS yang diwajibkan.

---

### Task 1: Dukungan EARS Indonesia

**Files:**

- Modify: `scripts/check-workflow-docs.mjs`
- Modify: `docs/engineering/requirements-workflow.md`
- Create: `docs/specs/active/2026-08-30-dashboard-operator-clarity.md`
- Create: `docs/plans/active/2026-08-30-dashboard-operator-clarity.md`

**Interfaces:**

- Consumes: Pola EARS Inggris yang sudah diterima checker.
- Produces: Pola `Titen harus`, `Saat`, `Selama`, dan `Jika ... maka`.

- [x] **Step 1: Tambah self-test EARS Indonesia.**

  Tambah criterion `Saat permintaan masuk, Titen harus merespons.` ke fixture valid.

- [x] **Step 2: Jalankan self-test dan lihat kegagalan yang tepat.**

  Run: `node scripts/check-workflow-docs.mjs --self-test`

  Expected: FAIL pada `AC-DEMO-002 does not match Event-driven syntax`.

- [x] **Step 3: Tambah pola Indonesia tanpa melemahkan pola Inggris.**

  Terima lima pola Indonesia. Pertahankan semua pola Inggris.

- [x] **Step 4: Jalankan self-test dan workflow checker.**

  Run: `node scripts/check-workflow-docs.mjs --self-test && node scripts/check-workflow-docs.mjs`

  Expected: PASS.

- [x] **Step 5: Commit spec dan dukungan workflow.**

  Commit: `6592068 docs: tetapkan kejelasan dashboard operator`.

### Task 2: Primitive tampilan collection

**Files:**

- Create: `src/lib/dashboard-view.ts`
- Modify: `src/pages/dashboard/index.astro`
- Modify: `src/styles/dashboard.css`
- Modify: `tests/dashboard.spec.ts`

**Interfaces:**

- Consumes: Object key-value dari same-origin dashboard adapter.
- Produces: `renderCollection(target, definition)` dan `renderFacts(target, definition)`.
- Produces: `CollectionDefinition`, `CollectionColumn`, `CollectionAction`, dan `FactDefinition`.

- [x] **Step 1: Tulis tes collection yang gagal.**

  Tambah fixture Projects dengan project scoped dan unscoped.
  Pastikan tabel mempunyai kolom Reference, Scope, Records, Subjects, dan Last write.
  Pastikan tampilan utama tidak memuat `Record 1`.
  Pastikan disclosure `Technical payload` tertutup.

- [x] **Step 2: Jalankan tes Projects dan lihat kegagalan.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts --grep "structured project directory"`

  Expected: FAIL karena tabel operator belum ada.

- [x] **Step 3: Buat primitive collection minimum.**

  `renderCollection` harus membuat summary, table, selected-record inspector,
  empty state, action cell, dan disclosure payload.

- [x] **Step 4: Hubungkan Projects ke primitive baru.**

  Gunakan field map yang eksplisit. Muat references saat operator memilih row.

- [x] **Step 5: Jalankan tes Projects.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts --grep "structured project directory"`

  Expected: PASS.

- [x] **Step 6: Refactor CSS collection.**

  Gunakan border tipis, spacing, table header sticky, inspector, dan mobile list.
  Jangan ubah shell, sidebar, topbar, atau Atlas graph.

### Task 3: Directory Subjects dan Projects

**Files:**

- Modify: `src/pages/dashboard/index.astro`
- Modify: `src/lib/dashboard-view.ts`
- Modify: `src/styles/dashboard.css`
- Modify: `tests/dashboard.spec.ts`

**Interfaces:**

- Consumes: `subjects`, `projects`, dan endpoint references saat ini.
- Produces: Directory row yang dapat dipilih dan inspector reference.

- [x] **Step 1: Tulis tes Subjects yang gagal.**

  Pastikan tabel menampilkan Identity, Type, References, dan Created.
  Pastikan pilihan subject memuat canonical references.

- [x] **Step 2: Jalankan tes directory.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts --grep "operator directories"`

  Expected: FAIL pada tabel Subjects.

- [x] **Step 3: Implementasikan Subjects.**

  Gunakan label sebagai nilai utama. Gunakan subject ID sebagai nilai teknis.

- [x] **Step 4: Jalankan tes directory.**

  Expected: PASS.

### Task 4: Work, Audit & Events, dan Federation

**Files:**

- Modify: `src/pages/dashboard/index.astro`
- Modify: `src/lib/dashboard-view.ts`
- Modify: `src/styles/dashboard.css`
- Modify: `tests/dashboard.spec.ts`

**Interfaces:**

- Consumes: `leases`, `handoffs`, `audit`, `events`, `peers`, dan federation log.
- Produces: Section terpisah untuk setiap record kind.

- [x] **Step 1: Tulis tes operasi yang gagal.**

  Pastikan Work membedakan lease dan handoff.
  Pastikan Audit membedakan audit record dan event.
  Pastikan Federation membedakan peer dan exchange log.

- [x] **Step 2: Jalankan tes operasi.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts --grep "structured operations"`

  Expected: FAIL karena accordion JSON masih menjadi tampilan utama.

- [x] **Step 3: Implementasikan tiga tampilan operasi.**

  Tampilkan status, actor, target, time, dan identifier yang relevan.
  Letakkan release lease, resolve handoff, dan sync peer pada row terkait.

- [x] **Step 4: Jalankan tes operasi.**

  Expected: PASS.

### Task 5: Approvals dan Releases

**Files:**

- Modify: `src/pages/dashboard/index.astro`
- Modify: `src/lib/dashboard-view.ts`
- Modify: `src/styles/dashboard.css`
- Modify: `tests/dashboard.spec.ts`

**Interfaces:**

- Consumes: `policies`, `approvals`, dan `releases`.
- Produces: Governance queue dengan state, version, target, dan row actions.

- [x] **Step 1: Tulis tes governance yang gagal.**

  Pastikan action hanya muncul pada state yang sesuai.
  Pastikan action memakai ID dan expected version dari row.

- [x] **Step 2: Jalankan tes governance.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts --grep "governance queues"`

  Expected: FAIL karena action terpisah dari record.

- [x] **Step 3: Implementasikan governance queue.**

  Pertahankan reason prompt dan confirmation contract.
  Muat ulang server state setelah mutasi.

- [x] **Step 4: Jalankan tes governance.**

  Expected: PASS.

### Task 6: Access dan API & Keys

**Files:**

- Modify: `src/pages/dashboard/index.astro`
- Modify: `src/lib/dashboard-view.ts`
- Modify: `src/styles/dashboard.css`
- Modify: `tests/dashboard.spec.ts`

**Interfaces:**

- Consumes: `principals`, `grants`, `key_clamp_preview`, dan `keys`.
- Produces: Authority table, grant table, clamp table, dan key table.

- [x] **Step 1: Tulis tes administration yang gagal.**

  Pastikan principal, grant, clamp, dan key mempunyai section terpisah.
  Pastikan revoke berada pada row yang benar.

- [x] **Step 2: Jalankan tes administration.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts --grep "structured administration"`

  Expected: FAIL pada section terstruktur.

- [x] **Step 3: Implementasikan administration view.**

  Pertahankan form Add User, Add Grant, Generate Key, dan gate capability.

- [x] **Step 4: Jalankan tes administration.**

  Expected: PASS.

### Task 7: Models, System, dan Context

**Files:**

- Modify: `src/pages/dashboard/index.astro`
- Modify: `src/lib/dashboard-view.ts`
- Modify: `src/styles/dashboard.css`
- Modify: `tests/dashboard.spec.ts`

**Interfaces:**

- Consumes: readiness checks, model tuples, context items, conflicts, instructions, dan policy snapshot.
- Produces: Fact grid dan context item list dengan detail teknis.

- [x] **Step 1: Tulis tes diagnostic yang gagal.**

  Pastikan model fields dan system checks tampil sebagai facts.
  Pastikan context items tampil sebagai selected items dan conflicts.

- [x] **Step 2: Jalankan tes diagnostic.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts --grep "structured diagnostics"`

  Expected: FAIL pada facts dan context list.

- [x] **Step 3: Implementasikan diagnostic view.**

  Pertahankan restart configuration sebagai disclosure teknis.
  Pertahankan token budget meter.

- [x] **Step 4: Jalankan tes diagnostic.**

  Expected: PASS.

### Task 8: State, aksesibilitas, dan visual regression

**Files:**

- Modify: `src/pages/dashboard/index.astro`
- Modify: `src/lib/dashboard-view.ts`
- Modify: `src/styles/dashboard.css`
- Modify: `tests/dashboard.spec.ts`
- Modify: `tests/dashboard-screenshots.spec.ts`
- Modify: `docs/assets/screenshots/dashboard-operator-projects.png`
- Modify: `docs/assets/screenshots/dashboard-operator-projects-mobile.png`

**Interfaces:**

- Consumes: Primitive collection dan shell dashboard.
- Produces: Empty, loading, error, unauthorized, keyboard, dan mobile behavior.

- [x] **Step 1: Tulis tes stale-state yang gagal.**

  Muat data privat. Paksa 401 atau disconnect. Pastikan DOM tidak menyimpan record.

- [x] **Step 2: Jalankan tes state.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts --grep "clears structured private data"`

  Expected: FAIL bila collection baru tidak dibersihkan.

- [x] **Step 3: Implementasikan reset terpusat.**

  Bersihkan table, inspector, payload disclosure, dan action handler.

- [x] **Step 4: Tambah screenshot Projects desktop dan mobile.**

  Run: `UPDATE_DASHBOARD_SCREENSHOTS=1 pnpm test:browser tests/dashboard-screenshots.spec.ts`

- [x] **Step 5: Jalankan tes keyboard dan mobile.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts`

  Expected: Semua tes lulus.

### Task 9: Dokumentasi produk dan changelog

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/dashboard.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/PRD.md` only if the product requirement changes.
- Modify: `PONYTAIL-DEBT.md` only if the debt inventory changes.

**Interfaces:**

- Consumes: Behavior dashboard yang terverifikasi.
- Produces: Dokumentasi faktual dan sinkron.

- [x] **Step 1: Perbarui README.**

  Jelaskan task-specific collections, selected-record inspector, dan technical payload.

- [x] **Step 2: Perbarui dashboard guide dan design guide.**

  Jelaskan pola ringkasan, filter, collection, inspector, dan payload teknis.

- [x] **Step 3: Perbarui changelog untuk target `0.9.0`.**

  Nyatakan area yang berubah. Jangan klaim perubahan API atau runtime.

- [x] **Step 4: Jalankan pemeriksaan dokumentasi.**

  Run: `pnpm check:routes && pnpm check:workflow && git diff --check`

  Expected: PASS.

### Task 10: Verifikasi repository dan package

**Files:**

- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: release metadata files selected by `pnpm release:sync`.

**Interfaces:**

- Consumes: Dashboard dan dokumentasi final.
- Produces: Package `titen-memory@0.9.0` yang belum diterbitkan.

- [x] **Step 1: Jalankan tes fokus.**

  Run: `pnpm build && pnpm test:browser tests/dashboard.spec.ts tests/dashboard-screenshots.spec.ts`

- [x] **Step 2: Jalankan seluruh gate repository.**

  Run: `pnpm test:all`

- [x] **Step 3: Jalankan typecheck dan audit.**

  Run: `pnpm typecheck`

  Run: `pnpm audit --prod`

  Audit lulus tanpa vulnerability. Typecheck menemukan utang lama di harness
  arsip, benchmark, contract test, dan mock Bun. Source dashboard yang diubah
  tidak menambah error typecheck.

- [x] **Step 4: Sinkronkan versi `0.9.0`.**

  Jalankan mekanisme release lokal yang terdokumentasi.

- [x] **Step 5: Verifikasi tarball bersih.**

  Run: `bash scripts/verify-pack.sh`

  Expected: Semua package smoke lulus.

- [x] **Step 6: Verifikasi status dan diff.**

  Run: `git diff --check && git status --short`

### Task 11: Commit, push, dan website

**Files:**

- Modify: `/home/ramaaditya/Project/titen-web` release page and release metadata through its documented sync command.

**Interfaces:**

- Consumes: Commit Titen yang sudah terverifikasi dan versi `0.9.0`.
- Produces: Branch GitHub, website commit, dan Cloudflare deployment.

- [x] **Step 1: Commit implementasi Titen.**

  Gunakan commit kecil. Tambah trailer CADIS pada setiap commit.

- [x] **Step 2: Push branch dan integrasikan ke main.**

  Verifikasi remote SHA setelah push.

- [x] **Step 3: Jalankan release sync pada titen-web.**

  Run: `pnpm release:sync 0.9.0`

- [x] **Step 4: Build dan check website.**

  Run: `pnpm build && pnpm check`

- [x] **Step 5: Commit dan push titen-web.**

  Tambah trailer CADIS pada commit.

- [x] **Step 6: Deploy website dengan prosedur manual repo.**

  Verifikasi hostname utama, changelog, release page, dan version metadata.

### Task 12: Persetujuan npm dan production release

**Files:**

- Move: `docs/specs/active/2026-08-30-dashboard-operator-clarity.md` to `docs/specs/done/2026-08-30-dashboard-operator-clarity.md`
- Move: `docs/plans/active/2026-08-30-dashboard-operator-clarity.md` to `docs/plans/done/2026-08-30-dashboard-operator-clarity.md`

**Interfaces:**

- Consumes: Tarball, website, commit SHA, dan rollback target yang terverifikasi.
- Produces: npm release, server release, smoke evidence, dan closed workflow artifacts.

- [x] **Step 1: Siapkan browser approval npm.**

  Jalankan `npm publish --registry https://registry.npmjs.org` hanya saat semua gate lulus.

- [x] **Step 2: Tunggu persetujuan Rama pada browser npm.**

  Jangan ulangi publikasi bila approval masih aktif.

- [x] **Step 3: Verifikasi npm registry.**

  Pastikan `latest`, integrity, gitHead, dan tarball sesuai commit.

- [x] **Step 4: Buat tag dan GitHub release manual.**

  Gunakan tag anotasi `v0.9.0`. Jangan gunakan GitHub Actions.

- [x] **Step 5: Simpan backup server.**

  Catat package, revision, database quick check, count aman, dan rollback path.

- [x] **Step 6: Upgrade server-wulan.**

  Pasang package exact dari registry npmjs. Tunggu health dan readiness.

- [x] **Step 7: Jalankan production smoke.**

  Verifikasi root, dashboard, health, readiness, schema, dan protected 401.

- [x] **Step 8: Konfirmasi rollback tidak diperlukan.**

  Production smoke lulus. Rollback tetap tersedia pada backup server dan
  revision deployment sebelumnya.

- [x] **Step 9: Tutup spec dan plan.**

  Isi acceptance evidence dan verification. Pindahkan kedua file ke `done/`.

- [x] **Step 10: Commit dan push bukti release.**

  Pastikan main, npm, website, server, tag, dan release memakai revision yang sesuai.

## Acceptance evidence map

| Acceptance criteria | Planned evidence |
| --- | --- |
| AC-DOC-001–AC-DOC-005 | Tes Projects dan primitive collection |
| AC-DOC-006–AC-DOC-009 | Tes empty, error, mutasi, dan reload |
| AC-DOC-010–AC-DOC-012 | Tes Projects dan Subjects |
| AC-DOC-013–AC-DOC-017 | Tes Work, Audit, Governance, Administration, dan Diagnostic |
| AC-DOC-018–AC-DOC-020 | Tes capability, server denial, session reset, keyboard, dan mobile |
| AC-DOC-021 | `pnpm build` dan bundle checker |
| AC-DOC-022 | README, guide, changelog, release sync, dan website smoke |
| AC-DOC-023 | Browser approval log dan npm publication order |
| AC-DOC-024 | Backup, production smoke, atau rollback smoke |

## Verification

- `pnpm test:all` lulus pada main. D1 lulus 128 tes. Bun dan SDK lulus 156 tes.
- Integration lulus 230 tes. Live dashboard verifier dan 15 tes browser lulus.
- Lima tes screenshot lulus saat baseline visual diperbarui.
- Build menghasilkan bundle dashboard 26,3 KiB gzip. Batasnya 80 KiB gzip.
- `pnpm audit --prod` tidak menemukan vulnerability.
- `bash scripts/verify-pack.sh` lulus sembilan dari sembilan pemeriksaan.
- Route checker, workflow checker, dan `git diff --check` lulus.
- `pnpm typecheck` masih gagal pada utang lama di luar source dashboard yang diubah.
- npmjs menerbitkan `titen-memory@0.9.0` dari gitHead `8bd45de148143025a85313af7f33f74edefa2c46`.
- Website memakai commit `82db3d32bc436c9fd451ad814221ab27493a18ad`.
- Cloudflare memakai Worker version `237a3872-b026-4c9d-88b0-35f86896d408`.
- server-wulan memakai package dan CLI 0.9.0. Health dan readiness lulus.
- Database server lulus quick check dan tetap memakai schema 23 dari 23.
- Endpoint privat tanpa otorisasi mengembalikan 401.

## Acceptance evidence

- AC-DOC-001, AC-DOC-002, AC-DOC-003, AC-DOC-004, dan AC-DOC-005 lulus melalui tes collection dan technical payload.
- AC-DOC-006, AC-DOC-007, AC-DOC-008, dan AC-DOC-009 lulus melalui tes empty state, stale-state reset, mutation, dan server reload.
- AC-DOC-010, AC-DOC-011, dan AC-DOC-012 lulus melalui tes Projects dan Subjects.
- AC-DOC-013, AC-DOC-014, AC-DOC-015, AC-DOC-016, dan AC-DOC-017 lulus melalui tes seluruh area operasional.
- AC-DOC-018, AC-DOC-019, dan AC-DOC-020 lulus melalui tes capability, session reset, keyboard, dan mobile 320 piksel.
- AC-DOC-021 lulus melalui build dan bundle checker.
- AC-DOC-022 lulus melalui README, guide, changelog, release page, dan production website smoke.
- AC-DOC-023 lulus setelah Rama memberi persetujuan npm melalui browser.
- AC-DOC-024 lulus melalui backup server dan production smoke. Rollback tidak diperlukan.
