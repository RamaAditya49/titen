---
work_id: dashboard-operator-clarity-20260830
status: active
stage: implement
outcome: pending
complexity: complex
created: 2026-08-30
updated: 2026-08-30
review_after: 2026-09-13
owner: CADIS
---

# Kejelasan dashboard operator

## Masalah

Dashboard memakai satu perender payload generik pada banyak area. Perender ini
menampilkan accordion dengan JSON mentah. Label cadangannya memakai nama seperti
`Record 1`. Pola ini tidak menjelaskan fungsi area atau tindakan operator.

Masalah ini memengaruhi Projects, Subjects, Work, Audit & Events, Models,
Federation, Access, API & Keys, Approvals, Releases, System, dan Context.

Memories dan Atlas sudah mempunyai hierarki tugas yang lebih jelas. Perubahan ini
memakai pola tersebut sebagai acuan. Perubahan ini tetap mempertahankan ciri
visual Titen.

## Tujuan

Titen harus menampilkan data operator sebagai informasi yang dapat dipindai.
Titen harus menempatkan tindakan pada record terkait. Titen harus tetap memberi
akses ke payload teknis untuk diagnosis.

## Ruang lingkup

- Ganti tampilan JSON utama dengan tabel, daftar, status, atau timeline.
- Tambah panel detail untuk record yang dipilih.
- Letakkan tindakan mutasi pada record terkait.
- Simpan payload teknis dalam disclosure yang tertutup secara default.
- Gunakan pola loading, empty, error, dan unauthorized yang konsisten.
- Pertahankan seluruh pemeriksaan capability dan otorisasi server.
- Pertahankan dukungan keyboard, 200 persen zoom, dan viewport 320 piksel.
- Perbarui README, dashboard guide, design guide, dan changelog.
- Sinkronkan release ke website Titen.
- Siapkan release npm manual setelah semua gate lokal lulus.

## Di luar ruang lingkup

- Jangan ubah REST API, MCP API, SQL, atau migration.
- Jangan tambah framework, dependency, atau state store.
- Jangan tampilkan count yang tidak diberikan oleh API.
- Jangan simpan credential atau data privat dalam browser storage.
- Jangan tambah GitHub Actions atau deployment otomatis.
- Jangan terbitkan npm tanpa persetujuan Rama melalui browser.

## Model interaksi

Setiap area memakai urutan berikut:

1. Header menjelaskan tugas operator.
2. Ringkasan menyatakan jumlah record yang berwenang.
3. Filter mempersempit data yang sudah diizinkan.
4. Tabel atau daftar menampilkan kolom utama.
5. Pilihan record membuka panel detail.
6. Disclosure teknis menampilkan payload lengkap bila diperlukan.

Projects menampilkan reference, scope, record count, subject count, dan last
write. Subjects menampilkan label, type, reference count, dan created time.
Work memisahkan leases dan handoffs. Audit memisahkan audit log dan events.
Governance memisahkan policies, approvals, dan releases.

Access menampilkan principals, grants, dan key clamp secara terstruktur. API &
Keys menampilkan key metadata serta tindakan revoke. Models dan System
menampilkan facts dan health checks. Federation menampilkan peers dan exchange
log. Context menampilkan budget, selected items, conflicts, dan instructions.

## Konten dan bahasa

Gunakan istilah produk yang sama pada semua area. Gunakan kalimat aktif. Gunakan
satu tindakan pada setiap instruksi. Batasi label dan bantuan pada informasi yang
dibutuhkan operator.

Bahasa antarmuka tetap mengikuti kontrak dashboard saat ini. Dokumentasi publik
memakai bahasa Inggris yang sesuai ASD-STE100. Dokumentasi kerja ini memakai
adaptasi ASD-STE100 dalam bahasa Indonesia.

## Keamanan

Tampilan baru hanya memakai respons yang sudah diizinkan. Filter lokal tidak
boleh meminta atau memperkirakan data tersembunyi. Detail teknis harus mengikuti
scope yang sama dengan tampilan utama.

Mutasi harus tetap memakai endpoint yang ada. Mutasi harus meminta konfirmasi
atau alasan bila kontrak saat ini mewajibkannya. UI harus membersihkan data privat
saat session berakhir atau capability berubah.

## Acceptance criteria

- **AC-DOC-001 — Ubiquitous:** Titen harus menampilkan setiap collection sebagai tabel, daftar, status, atau timeline yang sesuai tugas operator.
- **AC-DOC-002 — Ubiquitous:** Titen harus menghindari `Record N` sebagai label utama untuk record berwenang.
- **AC-DOC-003 — Event-driven:** Saat operator memilih record, Titen harus menampilkan detail record dalam konteks area yang sama.
- **AC-DOC-004 — Event-driven:** Saat operator membuka payload teknis, Titen harus menampilkan respons berwenang tanpa menambah data.
- **AC-DOC-005 — Ubiquitous:** Titen harus menutup payload teknis secara default.
- **AC-DOC-006 — Event-driven:** Saat collection kosong, Titen harus menjelaskan keadaan kosong tanpa memperkirakan count tersembunyi.
- **AC-DOC-007 — Unwanted behavior:** Jika permintaan gagal, maka Titen harus menghapus data lama dan menampilkan pesan aman.
- **AC-DOC-008 — Ubiquitous:** Titen harus menempatkan setiap tindakan mutasi pada record terkait.
- **AC-DOC-009 — Event-driven:** Saat mutasi berhasil, Titen harus memuat ulang collection dari server.
- **AC-DOC-010 — Ubiquitous:** Titen harus menampilkan reference, scope, record count, subject count, dan last write pada Projects.
- **AC-DOC-011 — Event-driven:** Saat operator memilih project, Titen harus menampilkan project ID dan normalized references.
- **AC-DOC-012 — Ubiquitous:** Titen harus menampilkan identity, type, reference count, dan created time pada Subjects.
- **AC-DOC-013 — Ubiquitous:** Titen harus membedakan leases dan handoffs dengan status yang terbaca pada Work.
- **AC-DOC-014 — Ubiquitous:** Titen harus membedakan metadata activity dan domain events pada Audit & Events.
- **AC-DOC-015 — Ubiquitous:** Titen harus menampilkan state, version, target, dan tindakan pada Approvals dan Releases.
- **AC-DOC-016 — Ubiquitous:** Titen harus menampilkan authority, clamp, dan credential metadata secara terstruktur.
- **AC-DOC-017 — Ubiquitous:** Titen harus menampilkan facts utama pada Models, System, Federation, dan Context.
- **AC-DOC-018 — Ubiquitous:** Titen harus mempertahankan navigation capability gate dan server authorization gate.
- **AC-DOC-019 — Ubiquitous:** Titen harus mendukung keyboard, reduced motion, forced colors, dan viewport 320 piksel.
- **AC-DOC-020 — Unwanted behavior:** Jika session berakhir, maka Titen harus menghapus semua hasil privat dari DOM.
- **AC-DOC-021 — Ubiquitous:** Titen harus menjaga dashboard CSS dan JavaScript di bawah batas gzip 80 KiB.
- **AC-DOC-022 — Ubiquitous:** Titen harus memperbarui README, dashboard guide, design guide, changelog, website, dan metadata versi.
- **AC-DOC-023 — Unwanted behavior:** Jika persetujuan npm belum diberikan, maka Titen harus menunda penerbitan package baru.
- **AC-DOC-024 — Event-driven:** Saat release selesai, Titen harus lulus production smoke atau mengaktifkan rollback yang terverifikasi.

## Risiko dan mitigasi

- Perender baru dapat salah membaca payload yang berbeda. Gunakan field map per collection dan fallback teknis yang aman.
- Tabel dapat melebar pada mobile. Gunakan daftar linear dan detail inline pada viewport kecil.
- Aksi dapat menargetkan record yang salah. Ikat handler ke ID dan version record yang dipilih.
- Bundle dapat melewati batas. Gunakan DOM dan CSS native tanpa dependency baru.
- Website dapat tertinggal dari npm. Jalankan release sync dan build sebelum deployment.

## Rollback

Revert commit dashboard bila verifikasi lokal gagal. Pertahankan package npm lama
sebagai `latest` sampai persetujuan diberikan. Simpan backup server sebelum
upgrade. Pulihkan package dan deployment website sebelumnya bila smoke gagal.

## Kondisi selesai

- Semua acceptance criteria mempunyai bukti yang dapat diulang.
- Semua tes, build, workflow, package, dan security gate lulus.
- README, dokumentasi dashboard, design guide, dan changelog sudah sinkron.
- Commit sudah didorong ke GitHub dengan trailer CADIS.
- Website sudah dibangun, didorong, dan dipasang.
- Npm sudah mendapat persetujuan Rama dan sudah diterbitkan.
- Server produksi memakai release baru atau rollback yang terverifikasi.
- Spec dan plan sudah pindah ke direktori `done/`.
