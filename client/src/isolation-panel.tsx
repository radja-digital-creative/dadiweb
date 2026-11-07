import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { Icon, downloadText, timeAgo } from "./lib";

function fmtBytesId(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2).replace(".", ",")} GB`;
}

const inputCls =
  "w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none";

// ---------------------------------------------------------------------------
// G2 — Panel Isolasi & Keamanan Proyek (di Editor)
//
// Menampilkan & menguji isolasi penuh proyek ini: skema DB sendiri
// (proj_<id>), kredensial DB proyek sendiri (bukan kredensial platform),
// kuota penyimpanan Executor, job sandbox tmp/<job_id>, rahasia per proyek
// terenkripsi (UI hanya menerima 4 karakter terakhir), metadata unggahan,
// ekspor ruang sendiri, dan catatan penghapusan proyek. Pemetaan jujur ke
// storage prototipe (SQLite, bukan PostgreSQL) tampil apa adanya dari
// server (mappingNote) — tidak ada klaim PostgreSQL sungguhan.
// ---------------------------------------------------------------------------

export function IsolationPanel({
  projectId,
  token,
  slug,
}: {
  projectId: number;
  token: string;
  slug: string;
}) {
  const queryClient = useQueryClient();
  const [secretForm, setSecretForm] = useState({ name: "", value: "" });
  const [secretNote, setSecretNote] = useState<string | null>(null);
  const [jobKind, setJobKind] = useState<"build" | "test">("build");
  const [jobTimeout, setJobTimeout] = useState(false);
  const [jobOversizeMb, setJobOversizeMb] = useState("");
  const [jobNetwork, setJobNetwork] = useState("");
  const [jobNote, setJobNote] = useState<string | null>(null);
  const [uploadForm, setUploadForm] = useState({ fileName: "", sizeKb: "200" });
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const iso = useQuery({
    queryKey: ["project-isolation", projectId, token],
    queryFn: () => api.getProjectIsolation({ token, projectId }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["project-isolation"] });
    void queryClient.invalidateQueries({ queryKey: ["project-detail"] });
  };

  const saveSecret = useMutation({
    mutationFn: () =>
      api.setProjectSecret({
        token,
        projectId,
        name: secretForm.name.trim(),
        value: secretForm.value,
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setSecretNote(
          res.rotated
            ? `Rahasia dirotasi ke versi kunci ${res.keyVersion} (petunjuk ${res.hint}). Kunci lama langsung tidak berlaku dan rotasinya tercatat di riwayat proyek.`
            : `Rahasia tersimpan terenkripsi (petunjuk ${res.hint}). Nilai penuh tidak pernah ditampilkan lagi.`,
        );
        setSecretForm({ name: "", value: "" });
        refresh();
      } else {
        setSecretNote(res.error ?? "Gagal menyimpan rahasia.");
      }
    },
    onError: (e) =>
      setSecretNote(e instanceof Error ? e.message : "Gagal menyimpan rahasia."),
  });

  const removeSecret = useMutation({
    mutationFn: (secretId: number) =>
      api.deleteProjectSecret({ token, projectId, secretId }),
    onSuccess: () => {
      setSecretNote("Rahasia dihapus dan tercatat di riwayat proyek.");
      refresh();
    },
  });

  const runJob = useMutation({
    mutationFn: () =>
      api.runExecutorJob({
        token,
        projectId,
        kind: jobKind,
        simulateTimeout: jobTimeout || undefined,
        simulateOversizeBytes: jobOversizeMb.trim()
          ? Math.round(Number(jobOversizeMb) * 1024 * 1024)
          : undefined,
        networkTarget: jobNetwork.trim() || undefined,
      }),
    onSuccess: (res) => {
      setJobNote(
        `Job #${res.jobId} (${res.sandboxDir}) — status: ${res.status}. ${res.detail}`,
      );
      refresh();
    },
    onError: (e) =>
      setJobNote(e instanceof Error ? e.message : "Job gagal dijalankan."),
  });

  const registerUpload = useMutation({
    mutationFn: () =>
      api.registerProjectUpload({
        token,
        projectId,
        fileName: uploadForm.fileName.trim(),
        mimeType: "",
        sizeBytes: Math.max(0, Math.round(Number(uploadForm.sizeKb || "0") * 1024)),
      }),
    onSuccess: (res) => {
      setUploadNote(
        res.ok
          ? "Metadata unggahan tercatat di uploads/ proyek ini (database hanya menyimpan nama + metadata, bukan isi berkas)."
          : (res.error ?? "Unggahan ditolak Executor."),
      );
      if (res.ok) setUploadForm({ fileName: "", sizeKb: "200" });
      refresh();
    },
    onError: (e) =>
      setUploadNote(e instanceof Error ? e.message : "Gagal mencatat unggahan."),
  });

  const exportProject = useMutation({
    mutationFn: () => api.exportProject({ token, projectId }),
    onSuccess: (res) => {
      if (res.found) {
        downloadText(`${slug}-ekspor-g2.json`, res.package, "application/json");
        setExportNote(
          "Ekspor selesai — isinya hanya ruang proyek ini: skema, tabel, file, deployment, metadata unggahan, dan petunjuk rahasia (nilai rahasia & kredensial platform tidak pernah ikut).",
        );
      } else {
        setExportNote("Ekspor ditolak: proyek tidak ditemukan di ruang milikmu.");
      }
    },
    onError: (e) =>
      setExportNote(e instanceof Error ? e.message : "Ekspor gagal."),
  });

  const d = iso.data;
  const usedPct = d
    ? Math.min(100, Math.round((d.storage.usedBytes / Math.max(d.storage.quotaBytes, 1)) * 100))
    : 0;

  return (
    <section className="mt-4 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-bold">
        <Icon name="shield" size={16} className="text-emerald-400" />
        Isolasi &amp; Keamanan Proyek (G2)
      </h2>

      {iso.isPending && (
        <p className="mt-2 text-sm text-[var(--dim)]">Memuat status isolasi…</p>
      )}
      {iso.isError && (
        <p className="mt-2 text-sm text-rose-300">
          Status isolasi gagal dimuat.{" "}
          <button onClick={() => void iso.refetch()} className="font-bold underline">
            Coba lagi
          </button>
        </p>
      )}

      {d && !d.found && (
        <p className="mt-2 text-sm text-[var(--dim)]">Proyek tidak ditemukan.</p>
      )}

      {d && d.found && (
        <div className="mt-3 space-y-5">
          {/* Skema + kredensial DB per proyek */}
          <div>
            <p className="text-sm font-bold">Skema &amp; kredensial database proyek</p>
            <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-3">
              <div className="rounded-xl bg-white/4 px-3 py-2.5">
                <dt className="text-[var(--dim)]">Skema proyek</dt>
                <dd className="mt-0.5 font-mono font-bold">{d.schemaName}</dd>
              </div>
              <div className="rounded-xl bg-white/4 px-3 py-2.5">
                <dt className="text-[var(--dim)]">Pengguna DB proyek</dt>
                <dd className="mt-0.5 font-mono font-bold">{d.dbUsername}</dd>
              </div>
              <div className="rounded-xl bg-white/4 px-3 py-2.5">
                <dt className="text-[var(--dim)]">Kata sandi DB (petunjuk)</dt>
                <dd className="mt-0.5 font-mono font-bold">{d.dbPasswordHint}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--dim)]">
              Setiap proyek punya skema dan pengguna database sendiri yang hanya
              berhak atas skema itu. Aplikasi hasil generate{" "}
              <span className="font-bold text-slate-200">tidak pernah</span>{" "}
              menerima kredensial database platform
              {d.platformCredentialExposed
                ? " — PERINGATAN: kredensial platform terekspos!"
                : " (terverifikasi di server: platformCredentialExposed = false)"}
              . Kata sandi penuh tidak disimpan di database aplikasi — hanya
              petunjuk 4 karakter terakhir di atas.
            </p>
          </div>

          {/* Kuota Executor */}
          <div>
            <p className="text-sm font-bold">Kuota penyimpanan Executor</p>
            <p className="mt-1 text-[13px] text-[var(--dim)]">
              Paket {d.storage.plan}: terpakai {fmtBytesId(d.storage.usedBytes)} dari{" "}
              {fmtBytesId(d.storage.quotaBytes)}. Penulisan yang akan melewati kuota
              ditolak Executor <em>sebelum</em> terjadi — bukan error disk penuh.
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                style={{ width: `${Math.max(usedPct, 1)}%` }}
              />
            </div>
          </div>

          {/* Env runtime */}
          <div>
            <p className="text-sm font-bold">Variabel lingkungan runtime proyek ini</p>
            <p className="mt-1 text-[13px] text-[var(--dim)]">
              Disuntikkan saat runtime hanya untuk proyek ini — tidak dibagikan ke
              proyek lain. Nilai sensitif tampil sebagai petunjuk saja.
            </p>
            <ul className="mt-2 space-y-1.5">
              {d.envVars.map((v) => (
                <li
                  key={v.name}
                  className="break-all rounded-lg bg-white/4 px-3 py-2 font-mono text-xs leading-relaxed"
                >
                  <span className="font-bold text-slate-100">{v.name}</span>
                  <span className="text-[var(--dim)]"> = {v.valuePreview}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Rahasia per proyek */}
          <div className="border-t border-[var(--border-soft)] pt-4">
            <p className="text-sm font-bold">Rahasia per proyek (terenkripsi)</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
              Kunci API proyek disimpan terenkripsi AES-256-GCM dengan kunci turunan
              per proyek. Di sini hanya tampil 4 karakter terakhir; nilai penuh tidak
              pernah ditulis ke file proyek, log pipeline, atau prompt model.
              Menyimpan nama yang sama = rotasi: kunci lama langsung tidak berlaku.
            </p>
            {d.secrets.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {d.secrets.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-white/4 px-3 py-2 text-[13px]"
                  >
                    <span className="font-mono font-bold">{s.name}</span>
                    <span className="font-mono text-[var(--dim)]">{s.hint}</span>
                    <span className="rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] font-bold">
                      versi kunci {s.keyVersion}
                    </span>
                    <span className="text-xs text-[var(--dim)]">
                      diperbarui {timeAgo(s.updatedAt)}
                    </span>
                    <button
                      onClick={() => removeSecret.mutate(s.id)}
                      disabled={removeSecret.isPending}
                      aria-label={`Hapus rahasia ${s.name}`}
                      className="ml-auto rounded-lg bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                    >
                      Hapus
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-[var(--dim)]">
                Belum ada rahasia untuk proyek ini.
              </p>
            )}
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                saveSecret.mutate();
              }}
            >
              <label className="block">
                <span className="sr-only">Nama rahasia (gaya env var)</span>
                <input
                  value={secretForm.name}
                  onChange={(e) => setSecretForm({ ...secretForm, name: e.target.value })}
                  placeholder="NAMA_RAHASIA (mis. DOKU_API_KEY)"
                  required
                  className={`${inputCls} font-mono`}
                />
              </label>
              <label className="block">
                <span className="sr-only">Nilai rahasia</span>
                <input
                  type="password"
                  value={secretForm.value}
                  onChange={(e) => setSecretForm({ ...secretForm, value: e.target.value })}
                  placeholder="Nilai rahasia (min. 4 karakter)"
                  required
                  minLength={4}
                  autoComplete="off"
                  className={inputCls}
                />
              </label>
              <button
                type="submit"
                disabled={saveSecret.isPending}
                className="rounded-xl bg-white/8 px-4 py-2.5 text-sm font-bold hover:bg-white/12 disabled:opacity-50"
              >
                {saveSecret.isPending ? "Mengenkripsi…" : "Simpan / Rotasi"}
              </button>
            </form>
            {secretNote && (
              <p role="status" className="mt-2 rounded-xl bg-white/5 px-3.5 py-2.5 text-[13px] leading-relaxed">
                {secretNote}
              </p>
            )}
            {d.secretEvents.length > 0 && (
              <div className="mt-3">
                <p className="text-[13px] font-bold">Riwayat rahasia proyek</p>
                <ul className="mt-1.5 space-y-1">
                  {d.secretEvents.slice(0, 6).map((e) => (
                    <li key={e.id} className="text-xs leading-relaxed text-[var(--dim)]">
                      <span className="font-mono font-bold text-slate-300">{e.secretName}</span>{" "}
                      — {e.detail}{" "}
                      <span className="text-[var(--dim-2)]">({timeAgo(e.createdAt)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Job sandbox Executor */}
          <div className="border-t border-[var(--border-soft)] pt-4">
            <p className="text-sm font-bold">Job Executor di sandbox tmp/&lt;job_id&gt;</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
              Build &amp; test berjalan di ruang kerja sandbox terpisah per job dengan
              salinan hanya-baca folder proyek; ruang kerja dihapus setelah job
              selesai. Jaringan keluar ditolak kecuali registry paket. Hasil yang
              lolos QA baru disalin Executor ke builds/ proyek.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Jenis job</span>
                <select
                  value={jobKind}
                  onChange={(e) => setJobKind(e.target.value as "build" | "test")}
                  aria-label="Jenis job Executor"
                  className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value="build">build</option>
                  <option value="test">test</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">
                  Simulasi: ukuran hasil build (MB, untuk uji kuota)
                </span>
                <input
                  value={jobOversizeMb}
                  onChange={(e) => setJobOversizeMb(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="kosongkan = ukuran normal"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">
                  Simulasi: host jaringan yang dicoba job
                </span>
                <input
                  value={jobNetwork}
                  onChange={(e) => setJobNetwork(e.target.value)}
                  placeholder="mis. registry.npmjs.org (izin) / evil.example.com (tolak)"
                  className={inputCls}
                />
              </label>
              <label className="flex items-end gap-2 pb-1 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={jobTimeout}
                  onChange={(e) => setJobTimeout(e.target.checked)}
                  className="h-4 w-4 accent-[#2E6BFF]"
                />
                Simulasi: job melewati batas waktu
              </label>
            </div>
            <button
              onClick={() => runJob.mutate()}
              disabled={runJob.isPending}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
            >
              <Icon name="rocket" size={15} />
              {runJob.isPending ? "Job berjalan…" : "Jalankan Job Sandbox"}
            </button>
            {jobNote && (
              <p role="status" className="mt-2 rounded-xl bg-white/5 px-3.5 py-2.5 text-[13px] leading-relaxed">
                {jobNote}
              </p>
            )}
            {d.jobs.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {d.jobs.map((j) => (
                  <li key={j.id} className="rounded-lg bg-white/4 px-3 py-2 text-xs leading-relaxed">
                    <span className="font-mono font-bold text-slate-100">
                      #{j.id} {j.sandboxDir}
                    </span>{" "}
                    · {j.kind} ·{" "}
                    <span
                      className={
                        j.status === "done"
                          ? "font-bold text-emerald-300"
                          : j.status === "timeout"
                            ? "font-bold text-amber-300"
                            : "font-bold text-rose-300"
                      }
                    >
                      {j.status}
                    </span>{" "}
                    · batas {j.timeLimitSec} dtk / {j.memoryLimitMb} MB · sandbox{" "}
                    {j.workspaceDeleted ? "sudah dihapus" : "BELUM dihapus"}
                    {j.copiedBack && (
                      <>
                        {" "}· hasil di <span className="font-mono">{j.artifactPath}</span>
                      </>
                    )}
                    <span className="block text-[var(--dim)]">{j.detail}</span>
                    <span className="block text-[var(--dim)]">{j.networkPolicy}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Unggahan + ekspor */}
          <div className="border-t border-[var(--border-soft)] pt-4">
            <p className="text-sm font-bold">Unggahan proyek (uploads/)</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
              Berkas tinggal di folder uploads/ proyek; database hanya menyimpan nama
              file + metadata (bukan isi/blob). Pencatatan di bawah ini mensimulasikan
              unggahan dengan ukuran yang kamu nyatakan — isi berkas tidak dikirim.
            </p>
            {d.uploads.length > 0 && (
              <ul className="mt-2 space-y-1">
                {d.uploads.map((u) => (
                  <li key={u.id} className="font-mono text-xs text-[var(--dim)]">
                    uploads/{u.fileName} · {u.mimeType || "tipe tidak dicatat"} ·{" "}
                    {fmtBytesId(u.sizeBytes)} · {timeAgo(u.createdAt)}
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[1fr_160px_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                registerUpload.mutate();
              }}
            >
              <label className="block">
                <span className="sr-only">Nama berkas unggahan</span>
                <input
                  value={uploadForm.fileName}
                  onChange={(e) => setUploadForm({ ...uploadForm, fileName: e.target.value })}
                  placeholder="nama-berkas.png"
                  required
                  className={`${inputCls} font-mono`}
                />
              </label>
              <label className="block">
                <span className="sr-only">Ukuran berkas (KB)</span>
                <input
                  value={uploadForm.sizeKb}
                  onChange={(e) =>
                    setUploadForm({ ...uploadForm, sizeKb: e.target.value.replace(/[^0-9]/g, "") })
                  }
                  inputMode="numeric"
                  placeholder="Ukuran (KB)"
                  aria-label="Ukuran berkas unggahan dalam KB"
                  className={inputCls}
                />
              </label>
              <button
                type="submit"
                disabled={registerUpload.isPending}
                className="rounded-xl bg-white/8 px-4 py-2.5 text-sm font-bold hover:bg-white/12 disabled:opacity-50"
              >
                Catat Unggahan
              </button>
            </form>
            {uploadNote && (
              <p role="status" className="mt-2 rounded-xl bg-white/5 px-3.5 py-2.5 text-[13px] leading-relaxed">
                {uploadNote}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => exportProject.mutate()}
                disabled={exportProject.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-sm font-bold hover:bg-white/12 disabled:opacity-50"
              >
                <Icon name="download" size={15} />
                {exportProject.isPending ? "Mengekspor…" : "Ekspor Ruang Proyek (G2)"}
              </button>
              <p className="text-xs text-[var(--dim)]">
                Ekspor selalu hanya mengekspor ruang milik peminta.
              </p>
            </div>
            {exportNote && (
              <p role="status" className="mt-2 rounded-xl bg-white/5 px-3.5 py-2.5 text-[13px] leading-relaxed">
                {exportNote}
              </p>
            )}
          </div>

          {/* Catatan penghapusan */}
          {d.deletionLog.length > 0 && (
            <div className="border-t border-[var(--border-soft)] pt-4">
              <p className="text-sm font-bold">Catatan penghapusan proyek (akun ini)</p>
              <ul className="mt-2 space-y-1.5">
                {d.deletionLog.map((del) => (
                  <li key={del.id} className="text-xs leading-relaxed text-[var(--dim)]">
                    <span className="font-bold text-slate-300">{del.projectName}</span>{" "}
                    (skema {del.schemaName}) — {del.detail}{" "}
                    <span className="text-[var(--dim-2)]">({timeAgo(del.createdAt)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5 text-xs leading-relaxed text-amber-200/90">
            {d.mappingNote}
          </p>
        </div>
      )}
    </section>
  );
}
