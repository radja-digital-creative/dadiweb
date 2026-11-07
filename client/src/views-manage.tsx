import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import {
CreditDonut,
Icon,
PLANS,
TOPUP_PACKS,
UsageLegend,
csvEscape,
downloadText,
fmtIdr,
parseCsv,
fmtNum,
statusBadge,
timeAgo,
type State,
} from "./lib";
import type { Nav } from "./views-main";

function ProjectPicker({
  state,
  value,
  onChange,
  label,
}: {
  state: State;
  value: number | null;
  onChange: (id: number) => void;
  label: string;
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-[var(--dim)]">
      {label}
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-white focus:border-[var(--accent)] focus:outline-none"
      >
        {state.projects
          .filter((p) => p.status !== "archived")
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export function DatabaseView({
  state,
  nav,
  token,
  focusProjectId,
}: {
  state: State;
  nav: Nav;
  token: string;
  focusProjectId?: number | null;
}) {
  const queryClient = useQueryClient();
  const firstProject =
    state.projects.find((p) => p.status !== "archived") ?? state.projects[0];
  const [projectId, setProjectId] = useState<number | null>(
    focusProjectId ?? firstProject?.id ?? null,
  );
  const [tableId, setTableId] = useState<number | null>(null);
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (focusProjectId) setProjectId(focusProjectId);
  }, [focusProjectId]);

  const detail = useQuery({
    queryKey: ["project-detail", projectId, token],
    queryFn: () => api.getProjectDetail({ token, projectId: projectId ?? 0 }),
    enabled: projectId !== null,
  });

  const tables = detail.data?.tables ?? [];
  const activeTable =
    tables.find((t) => t.id === tableId) ?? tables[0] ?? null;

  const addRow = useMutation({
    mutationFn: () => {
      if (!activeTable) throw new Error("Tidak ada tabel aktif");
      const data: Record<string, string> = {};
      for (const col of activeTable.columns) {
        data[col] = (newRow[col] ?? "").trim();
      }
      return api.addTableRow({ token, tableId: activeTable.id, data });
    },
    onSuccess: () => {
      setNewRow({});
      setNote("Baris data tersimpan.");
      void queryClient.invalidateQueries({
        queryKey: ["project-detail"],
      });
    },
  });

  const deleteRow = useMutation({
    mutationFn: (rowId: number) => api.deleteTableRow({ token, rowId }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["project-detail"],
      }),
  });

  const [tableForm, setTableForm] = useState({ name: "", columns: "id, nama, dibuat_pada" });
  const [tableError, setTableError] = useState<string | null>(null);
  const [confirmDeleteTable, setConfirmDeleteTable] = useState(false);

  const createTable = useMutation({
    mutationFn: () =>
      api.createProjectTable({
        token,
        projectId: projectId ?? 0,
        name: tableForm.name.trim(),
        columns: tableForm.columns.split(",").map((c) => c.trim()).filter(Boolean),
      }),
    onSuccess: (res) => {
      setTableForm({ name: "", columns: "id, nama, dibuat_pada" });
      setTableError(null);
      setTableId(res.id);
      setNote("Tabel baru berhasil dibuat.");
      void queryClient.invalidateQueries({ queryKey: ["project-detail"] });
    },
    onError: (e) => setTableError(e instanceof Error ? e.message : "Gagal membuat tabel."),
  });

  const deleteTable = useMutation({
    mutationFn: () => api.deleteProjectTable({ token, tableId: activeTable?.id ?? 0 }),
    onSuccess: () => {
      setConfirmDeleteTable(false);
      setTableId(null);
      setNote("Tabel berhasil dihapus.");
      void queryClient.invalidateQueries({ queryKey: ["project-detail"] });
    },
  });

  const exportCsv = () => {
    if (!activeTable) return;
    const header = activeTable.columns.join(",");
    const lines = activeTable.rows.map((r) =>
      activeTable.columns.map((c) => csvEscape(r.data[c] ?? "")).join(","),
    );
    downloadText(`${activeTable.name}.csv`, [header, ...lines].join("\n"), "text/csv");
    setNote(`Tabel ${activeTable.name} diekspor sebagai CSV (${activeTable.rows.length} baris).`);
  };

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const importCsvFile = async (file: File) => {
    if (!activeTable) return;
    setImporting(true);
    setImportError(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length < 2) {
        throw new Error("File CSV harus punya baris header dan minimal satu baris data.");
      }
      const header = parsed[0]!.map((h) => h.trim());
      const known = header.filter((h) => activeTable.columns.includes(h));
      if (known.length === 0) {
        throw new Error(
          `Header CSV tidak cocok dengan kolom tabel ini (${activeTable.columns.join(", ")}). Samakan nama kolomnya dulu.`,
        );
      }
      const rows = parsed.slice(1, 501).map((cells) => {
        const obj: Record<string, string> = {};
        header.forEach((h, i) => {
          obj[h] = (cells[i] ?? "").trim();
        });
        return obj;
      });
      const res = await api.importTableRows({
        token,
        tableId: activeTable.id,
        rows,
      });
      setNote(
        `Impor CSV selesai: ${res.inserted} baris ditambahkan ke tabel ${activeTable.name}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["project-detail"] });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Impor CSV gagal.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Database</h1>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Tabel dibuat otomatis oleh AI saat website digenerate. Kamu bisa
            menambah dan menghapus data langsung di sini.
            {projectId !== null && (
              <>
                {" "}Setiap proyek punya skema sendiri — proyek ini memakai{" "}
                <span className="font-mono font-bold text-emerald-300">
                  proj_{projectId}
                </span>{" "}
                dengan pengguna DB-nya sendiri, jadi tabelnya tidak tercampur
                dengan proyek lain (G2).
              </>
            )}
          </p>
        </div>
        <ProjectPicker
          state={state}
          value={projectId}
          onChange={(id) => {
            setProjectId(id);
            setTableId(null);
          }}
          label="Proyek:"
        />
      </div>

      {detail.isPending && projectId !== null && (
        <p className="py-14 text-center text-sm text-[var(--dim)]">Memuat database…</p>
      )}

      {!detail.isPending && tables.length === 0 && (
        <div className="mt-6 rounded-3xl border border-dashed border-[var(--border)] p-10 text-center">
          <p className="font-bold">Proyek ini belum punya tabel database</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-[var(--dim)]">
            Tabel dibuat otomatis oleh tahap Planner saat kamu membuat website
            dengan AI — misalnya tabel products, orders, dan users untuk toko
            online.
          </p>
          <button
            onClick={() => nav.go("create")}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white"
          >
            <Icon name="spark" size={15} /> Buat Website dengan AI
          </button>
        </div>
      )}

      {activeTable && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
          <nav
            className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
            aria-label="Daftar tabel"
          >
            {tables.map((t) => (
              <button
                key={t.id}
                onClick={() => setTableId(t.id)}
                aria-pressed={activeTable.id === t.id}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold transition ${
                  activeTable.id === t.id
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface)] text-[var(--dim)] ring-1 ring-[var(--border-soft)] hover:text-white"
                }`}
              >
                <Icon name="table" size={16} />
                {t.name}
                <span className="ml-auto text-xs opacity-75 tnum">{t.rows.length}</span>
              </button>
            ))}
          </nav>

          <section className="min-w-0 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">
                Tabel: <span className="font-mono text-[#6EA8FF]">{activeTable.name}</span>{" "}
                <span className="ml-1 rounded-md bg-emerald-500/12 px-2 py-0.5 align-middle font-mono text-[11px] font-bold text-emerald-300">
                  skema {activeTable.schemaName}
                </span>
              </h2>
              <span className="flex items-center gap-2">
                <span className="text-xs text-[var(--dim)]">
                  {activeTable.rows.length} baris · {activeTable.columns.length} kolom
                </span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-xs font-bold hover:bg-white/12">
                  <Icon name="upload" size={13} />
                  {importing ? "Mengimpor…" : "Impor CSV"}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    aria-label={`Impor file CSV ke tabel ${activeTable.name}`}
                    className="sr-only"
                    disabled={importing}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void importCsvFile(f);
                    }}
                  />
                </label>
                <button
                  onClick={exportCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-xs font-bold hover:bg-white/12"
                >
                  <Icon name="download" size={13} /> Ekspor CSV
                </button>
                <button
                  onClick={() => setConfirmDeleteTable(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
                >
                  <Icon name="trash" size={13} /> Hapus Tabel
                </button>
              </span>
            </div>
            {importError && (
              <p role="alert" className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
                Impor CSV gagal: {importError}
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
              Impor CSV: baris pertama file harus header yang namanya sama
              dengan kolom tabel; maksimal 500 baris per impor.
            </p>
            {confirmDeleteTable && (
              <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                Hapus tabel <strong>{activeTable.name}</strong> beserta {activeTable.rows.length} baris datanya?
                <span className="ml-3 inline-flex gap-2">
                  <button onClick={() => deleteTable.mutate()} disabled={deleteTable.isPending} className="font-bold underline underline-offset-2 disabled:opacity-60">
                    {deleteTable.isPending ? "Menghapus…" : "Ya, hapus"}
                  </button>
                  <button onClick={() => setConfirmDeleteTable(false)} className="font-bold underline underline-offset-2">
                    Batal
                  </button>
                </span>
              </div>
            )}

            <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--border-soft)]">
              <table className="w-full min-w-[480px] text-left text-[13px]">
                <thead>
                  <tr className="bg-[#0A1130] text-[var(--dim)]">
                    {activeTable.columns.map((c) => (
                      <th key={c} className="px-3 py-2.5 font-mono font-semibold">
                        {c}
                      </th>
                    ))}
                    <th className="px-3 py-2.5">
                      <span className="sr-only">Aksi</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeTable.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={activeTable.columns.length + 1}
                        className="px-3 py-6 text-center text-[var(--dim)]"
                      >
                        Belum ada data. Tambahkan baris pertama lewat formulir
                        di bawah.
                      </td>
                    </tr>
                  )}
                  {activeTable.rows.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border-soft)]">
                      {activeTable.columns.map((c) => (
                        <td key={c} className="px-3 py-2.5 font-mono text-slate-200">
                          {row.data[c] || <span className="text-[var(--dim-2)]">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => deleteRow.mutate(row.id)}
                          aria-label={`Hapus baris ${row.id} dari tabel ${activeTable.name}`}
                          className="rounded-lg bg-rose-500/10 px-2 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                addRow.mutate();
              }}
            >
              <h3 className="text-sm font-bold">Tambah Data</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {activeTable.columns.map((c) => (
                  <label key={c} className="block">
                    <span className="mb-1 block font-mono text-xs text-[var(--dim)]">{c}</span>
                    <input
                      value={newRow[c] ?? ""}
                      onChange={(e) =>
                        setNewRow({ ...newRow, [c]: e.target.value })
                      }
                      placeholder={`Nilai ${c}`}
                      aria-label={`Nilai kolom ${c}`}
                      className="w-full rounded-lg border border-[var(--border)] bg-[#0A1130] px-3 py-2 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </label>
                ))}
              </div>
              {note && (
                <p role="status" className="mt-2 text-sm text-emerald-300">{note}</p>
              )}
              {addRow.isError && (
                <p role="alert" className="mt-2 text-sm text-rose-300">
                  Gagal menambah data: {String(addRow.error)}
                </p>
              )}
              <button
                type="submit"
                disabled={addRow.isPending}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
              >
                <Icon name="plus" size={15} />
                {addRow.isPending ? "Menyimpan…" : "Tambah Data"}
              </button>
            </form>
          </section>
        </div>
      )}

      {projectId !== null && (
        <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-[15px] font-bold">Buat Tabel Manual</h2>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Selain otomatis dari AI, kamu bisa membuat tabel sendiri untuk proyek ini.
          </p>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              createTable.mutate();
            }}
          >
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Nama tabel</span>
              <input
                value={tableForm.name}
                onChange={(e) => setTableForm({ ...tableForm, name: e.target.value })}
                required
                placeholder="pelanggan"
                aria-label="Nama tabel baru"
                className="w-full rounded-lg border border-[var(--border)] bg-[#0A1130] px-3 py-2 font-mono text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Kolom (pisahkan koma)</span>
              <input
                value={tableForm.columns}
                onChange={(e) => setTableForm({ ...tableForm, columns: e.target.value })}
                required
                aria-label="Kolom tabel baru"
                className="w-full rounded-lg border border-[var(--border)] bg-[#0A1130] px-3 py-2 font-mono text-sm text-white focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={createTable.isPending}
              className="self-end rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
            >
              {createTable.isPending ? "Membuat…" : "Buat Tabel"}
            </button>
          </form>
          {tableError && (
            <p role="alert" className="mt-2 text-sm text-rose-300">{tableError}</p>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Domain & Deploy
// ---------------------------------------------------------------------------

// G10 — langkah deploy dihitung dari data deployment NYATA, bukan dari
// status proyek. Dulu semua langkah centang hanya karena status =
// "online", padahal tidak ada record DNS sama sekali. Sekarang:
// DNS = deployment live punya cloudflare_record_id; diterbitkan =
// ada deployment live; bisa dibuka = keduanya terpenuhi. Selama
// Cloudflare belum terkonfigurasi (atau deployment pra-G10 tanpa
// record), langkah DNS tampil "Menunggu", bukan "Selesai".

export function DeployView({
  state,
  token,
  focusProjectId,
}: {
  state: State;
  token: string;
  focusProjectId?: number | null;
}) {
  const queryClient = useQueryClient();
  const firstProject =
    state.projects.find((p) => p.status !== "archived") ?? state.projects[0];
  const [projectId, setProjectId] = useState<number | null>(
    focusProjectId ?? firstProject?.id ?? null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (focusProjectId) setProjectId(focusProjectId);
  }, [focusProjectId]);

  const project = state.projects.find((p) => p.id === projectId) ?? null;
  const projectDeployments = state.deployments.filter(
    (d) => d.projectId === projectId,
  );
  const deployment =
    projectDeployments.find((d) => d.status === "live") ??
    projectDeployments[0];

  const deploy = useMutation({
    mutationFn: () => api.deployProject({ token, projectId: projectId ?? 0 }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      setNotice(
        res.ok
          ? `Deploy selesai! ${project?.name ?? "Proyek"} sekarang live di ${res.subdomain} (−25 kredit).`
          : (res.error ?? "Deploy gagal."),
      );
    },
    onError: (e) => setNotice(String(e instanceof Error ? e.message : e)),
  });

  const rollback = useMutation({
    mutationFn: (deploymentId: number) =>
      api.rollbackDeployment({ token, deploymentId }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      setNotice(
        res.ok
          ? "Rollback selesai — versi deployment itu sekarang tayang lagi di subdomain proyek. Rollback tidak memotong kredit."
          : (res.error ?? "Rollback gagal."),
      );
    },
    onError: (e) => setNotice(String(e instanceof Error ? e.message : e)),
  });

  const [domainInput, setDomainInput] = useState("");
  const [domainError, setDomainError] = useState<string | null>(null);
  const [txtChecks, setTxtChecks] = useState<Record<number, boolean>>({});
  const projectDomains = state.customDomains.filter((d) => d.projectId === projectId);

  const addDomain = useMutation({
    mutationFn: () => api.addCustomDomain({ token, projectId: projectId ?? 0, domain: domainInput.trim() }),
    onSuccess: () => {
      setDomainInput("");
      setDomainError(null);
      setNotice("Domain ditambahkan. Pasang TXT record verifikasinya, lalu klik Verifikasi.");
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
    },
    onError: (e) => setDomainError(e instanceof Error ? e.message : "Gagal menambahkan domain."),
  });
  const verifyDomain = useMutation({
    mutationFn: (domainId: number) => api.verifyCustomDomain({ token, domainId, txtConfirmed: true }),
    onSuccess: () => {
      setNotice("Domain terverifikasi dan aktif — sertifikat SSL diterbitkan otomatis.");
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
    },
    onError: (e) => setNotice(String(e instanceof Error ? e.message : e)),
  });
  const deleteDomain = useMutation({
    mutationFn: (domainId: number) => api.deleteCustomDomain({ token, domainId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] }),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Domain &amp; Deploy</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Publikasikan proyek ke internet dengan mudah — setiap proyek terbit di
        subdomain *.dadiweb.id.
      </p>

      <div className="mt-5">
        <ProjectPicker
          state={state}
          value={projectId}
          onChange={setProjectId}
          label="Proyek:"
        />
      </div>

      {project && (
        <section className="mt-4 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{project.slug}.dadiweb.id</p>
              <p className="text-xs text-[var(--dim)]">
                {project.name} ·{" "}
                {project.status === "online"
                  ? `Terakhir deploy ${deployment ? timeAgo(deployment.createdAt) : ""}`
                  : "Belum pernah di-deploy"}
              </p>
            </div>
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusBadge(project.status).cls}`}
            >
              {project.status === "online" ? "Online" : "Draft"}
            </span>
          </div>

          <ol className="mt-4 space-y-2">
            {(() => {
              const liveDeployment =
                deployment?.status === "live" ? deployment : null;
              const dnsDone = Boolean(liveDeployment?.cloudflareRecordId);
              const steps = [
                { label: "DNS record subdomain dibuat", done: dnsDone },
                { label: "Situs diterbitkan", done: Boolean(liveDeployment) },
                {
                  label: "Alamat bisa dibuka",
                  done: Boolean(liveDeployment) && dnsDone,
                },
              ];
              return steps.map((step) => (
                <li
                  key={step.label}
                  className="flex items-center gap-3 rounded-xl bg-white/4 px-3.5 py-2.5 text-sm"
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-white ${
                      step.done ? "bg-emerald-500" : "bg-white/15"
                    }`}
                  >
                    <Icon name={step.done ? "check" : "dots"} size={12} />
                  </span>
                  <span className="flex-1 font-semibold">{step.label}</span>
                  <span
                    className={`text-xs font-bold ${step.done ? "text-emerald-400" : "text-[var(--dim)]"}`}
                  >
                    {step.done ? "Selesai" : "Menunggu"}
                  </span>
                </li>
              ));
            })()}
          </ol>
          {deployment?.status === "live" && !deployment.cloudflareRecordId && (
            <p className="mt-3 text-sm leading-relaxed text-amber-300">
              Deployment ini belum punya record DNS (dibuat sebelum
              integrasi Cloudflare). Deploy ulang setelah Cloudflare
              terkonfigurasi di panel admin untuk membuat record DNS-nya —
              langkah DNS di atas sengaja tampil “Menunggu”, bukan
              “Selesai”.
            </p>
          )}
          {project.status !== "online" && (
            <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
              Deploy memerlukan settings Cloudflare di panel admin; tanpa
              itu deploy akan gagal bersih tanpa potong kredit.
            </p>
          )}
          {deployment?.status === "live" &&
            Boolean(deployment.cloudflareRecordId) && (
              <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
                DNS sudah dibuat. Akses HTTPS subdomain sungguhan masih
                menunggu vhost wildcard + SSL di staging (di luar
                prototipe).
              </p>
            )}

          {notice && (
            <p
              role="status"
              className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300"
            >
              {notice}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => deploy.mutate()}
              disabled={deploy.isPending || projectId === null}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-5 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
            >
              <Icon name="rocket" size={15} />
              {deploy.isPending
                ? "Sedang Deploy…"
                : project.status === "online"
                  ? "Redeploy (25 kredit)"
                  : "Deploy Sekarang (25 kredit)"}
            </button>
            <span className="text-xs text-[var(--dim)]">
              Saldo kredit: <strong className="text-white tnum">{fmtNum(state.account.balance)}</strong>
            </span>
          </div>
        </section>
      )}

      <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
        <h2 className="text-[15px] font-bold">Domain Custom</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Hubungkan domain milikmu sendiri ke proyek ini. Arahkan juga CNAME{" "}
          <span className="font-mono text-slate-200">www</span> ke{" "}
          <span className="font-mono text-slate-200">{project?.slug ?? "proyek"}.dadiweb.id</span>,
          pasang TXT record verifikasinya, lalu klik Verifikasi — SSL terbit otomatis.
        </p>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addDomain.mutate();
          }}
        >
          <label className="min-w-[220px] flex-1">
            <span className="sr-only">Domain custom baru</span>
            <input
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="www.tokosaya.com"
              required
              className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3.5 py-2.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={addDomain.isPending || projectId === null}
            className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
          >
            {addDomain.isPending ? "Menambahkan…" : "Tambah Domain"}
          </button>
        </form>
        {domainError && (
          <p role="alert" className="mt-2 text-sm text-rose-300">{domainError}</p>
        )}

        {projectDomains.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--dim)]">
            Belum ada domain custom untuk proyek ini — proyek tetap bisa diakses dari subdomain dadiweb.id di atas.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {projectDomains.map((d) => (
              <li key={d.id} className="rounded-2xl border border-[var(--border-soft)] bg-[#0A1130] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon name="globe" size={16} className="text-[#6EA8FF]" />
                  <span className="font-mono text-sm font-bold">{d.domain}</span>
                  {d.isPrimary && (
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-[var(--dim)]">Utama</span>
                  )}
                  <span
                    className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      d.status === "active"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400"
                    }`}
                  >
                    {d.status === "active" ? "Aktif · SSL Aktif" : "Menunggu Verifikasi"}
                  </span>
                  <button
                    onClick={() => deleteDomain.mutate(d.id)}
                    aria-label={`Hapus domain ${d.domain}`}
                    className="rounded-lg bg-rose-500/10 px-2 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
                  >
                    Hapus
                  </button>
                </div>
                {d.status !== "active" && (
                  <div className="mt-3 text-sm">
                    <p className="text-[var(--dim)]">
                      Tambahkan TXT record ini di DNS domainmu:
                    </p>
                    <p className="mt-1.5 overflow-x-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-slate-200">
                      _dadiweb.{d.domain} &nbsp;TXT&nbsp; {d.verificationToken}
                    </p>
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
                      <input
                        type="checkbox"
                        checked={txtChecks[d.id] ?? false}
                        onChange={(e) => setTxtChecks({ ...txtChecks, [d.id]: e.target.checked })}
                        className="h-4 w-4 accent-[#2E6BFF]"
                      />
                      Saya sudah memasang TXT record tersebut
                    </label>
                    <button
                      onClick={() => verifyDomain.mutate(d.id)}
                      disabled={!(txtChecks[d.id] ?? false) || verifyDomain.isPending}
                      className="mt-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {verifyDomain.isPending ? "Memverifikasi…" : "Verifikasi & Aktifkan SSL"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {project && (
        <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-[15px] font-bold">
            Riwayat Deploy — {project.name}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
            Setiap deploy dan redeploy tercatat sebagai versi baru. Versi
            lama tetap tersimpan dan bisa ditayangkan lagi lewat rollback
            (gratis, tanpa potong kredit).
          </p>
          {projectDeployments.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--dim)]">
              Proyek ini belum pernah di-deploy. Klik Deploy Sekarang di atas
              untuk menerbitkan versi pertamanya.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border-soft)]">
              {projectDeployments.map((d) => {
                const kindLabel =
                  d.kind === "rollback"
                    ? "Rollback"
                    : d.kind === "redeploy"
                      ? "Redeploy"
                      : "Deploy";
                const isLive = d.status === "live";
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                    <Icon name="rocket" size={15} className="shrink-0 text-[var(--dim)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {kindLabel} #{d.id} — {d.subdomain}
                      </span>
                      <span className="block text-xs text-[var(--dim)]">
                        {timeAgo(d.createdAt)}
                        {d.note ? ` · ${d.note}` : ""}
                      </span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        isLive
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-white/8 text-[var(--dim)]"
                      }`}
                    >
                      {isLive
                        ? "Sedang Tayang"
                        : d.status === "superseded"
                          ? "Digantikan"
                          : d.status}
                    </span>
                    {!isLive && (
                      <button
                        onClick={() => rollback.mutate(d.id)}
                        disabled={rollback.isPending}
                        aria-label={`Rollback ${project.name} ke deployment ${d.id}`}
                        className="rounded-lg bg-white/8 px-2.5 py-1.5 text-xs font-bold ring-1 ring-[var(--border)] transition hover:bg-white/12 disabled:opacity-60"
                      >
                        {rollback.isPending ? "Memproses…" : "Rollback ke Versi Ini"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kredit & Langganan
// ---------------------------------------------------------------------------

export function CreditsView({ state, token }: { state: State; token: string }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<
    State["invoices"][number] | null
  >(null);
  const used = state.account.monthlyQuota - state.account.balance;
  const pct = Math.min(
    100,
    Math.round((used / Math.max(state.account.monthlyQuota, 1)) * 100),
  );
  const activePlan = PLANS.find((p) => p.name === state.account.plan) ?? PLANS[1]!;

  const topUp = useMutation({
    mutationFn: (pack: { credits: number; label: string }) =>
      api.topUpCredits({ token, packCredits: pack.credits, packLabel: pack.label }),
    onSuccess: (_res, pack) => {
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      setNotice(
        `Top up berhasil: +${fmtNum(pack.credits)} kredit dari paket ${pack.label}. Di prototipe ini pembayaran DOKU disimulasikan — tidak ada uang sungguhan yang ditarik.`,
      );
    },
  });

  const changePlan = useMutation({
    mutationFn: (plan: "Free" | "Pro Plan" | "Bisnis") => api.changePlan({ token, plan }),
    onSuccess: (res, plan) => {
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      setNotice(
        res.ok
          ? `Paket berhasil diganti ke ${plan}. Kuota sekarang ${fmtNum(res.monthlyQuota)} kredit/bulan dan saldo ${fmtNum(res.balance)} kredit. Di prototipe ini pembayaran langganan DOKU disimulasikan.`
          : (res.error ?? "Gagal mengganti paket."),
      );
    },
    onError: (e) => setNotice(String(e instanceof Error ? e.message : e)),
  });

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Kredit &amp; Langganan</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Setiap aktivitas AI tercatat transparan di buku besar kredit.
      </p>

      {notice && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        >
          {notice}
        </p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[380px_1fr]">
        <section className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <h2 className="text-[15px] font-bold">Kredit Saya</h2>
          <div className="mt-4 flex items-center gap-5">
            <CreditDonut
              usage={state.usage}
              balance={state.account.balance}
              quota={state.account.monthlyQuota}
              size={140}
            />
            <div className="min-w-0 flex-1">
              <UsageLegend usage={state.usage} quota={state.account.monthlyQuota} />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-[var(--dim)]">
              <span>
                Terpakai <strong className="text-white tnum">{fmtNum(used)}</strong> kredit
              </span>
              <span className="tnum">{pct}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-[#0A1130] p-4">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Icon name="crown" size={16} className="text-amber-400" />
              {state.account.plan}
              {activePlan.price > 0 ? ` — ${fmtIdr(activePlan.price)} / bulan` : " — Gratis"}
            </p>
            <ul className="mt-2 space-y-1 text-[13px] text-[var(--dim)]">
              {activePlan.features.map((f) => (
                <li key={f} className="flex items-center gap-1.5">
                  <Icon name="check" size={13} className="text-emerald-400" /> {f}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <h2 className="text-[15px] font-bold">Riwayat Penggunaan</h2>
          {state.ledger.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
              Belum ada transaksi kredit. Riwayat akan muncul di sini setiap
              kamu membuat website, deploy, atau top up — khusus akunmu, tidak
              tercampur dengan pengguna lain.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border-soft)]">
              {state.ledger.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      l.amount < 0
                        ? "bg-[#2E6BFF]/15 text-[#6EA8FF]"
                        : "bg-emerald-500/15 text-emerald-400"
                    }`}
                  >
                    <Icon name={l.kind === "topup" ? "plus" : l.kind === "deploy" ? "rocket" : "spark"} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{l.label}</span>
                    <span className="text-xs text-[var(--dim)]">
                      {l.category} · {timeAgo(l.createdAt)} · saldo setelahnya{" "}
                      <span className="tnum">{fmtNum(l.balanceAfter)}</span>
                    </span>
                  </span>
                  <span
                    className={`tnum shrink-0 font-bold ${l.amount < 0 ? "text-slate-200" : "text-emerald-400"}`}
                  >
                    {l.amount > 0 ? "+" : "−"}
                    {fmtNum(Math.abs(l.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <h2 className="text-[15px] font-bold">Invoice &amp; Kuitansi</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Setiap top up kredit dan ganti paket menerbitkan invoice. Klik
          untuk membuka kuitansinya.
        </p>
        {state.invoices.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--dim)]">
            Belum ada invoice — invoice pertama terbit saat kamu top up
            kredit atau mengganti paket.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border-soft)]">
            {state.invoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/8 text-[var(--dim)]">
                  <Icon name="card" size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{inv.title}</span>
                  <span className="text-xs text-[var(--dim)]">
                    {inv.number} · {timeAgo(inv.createdAt)} ·{" "}
                    {inv.creditsDelta > 0 ? "+" : inv.creditsDelta < 0 ? "−" : ""}
                    {fmtNum(Math.abs(inv.creditsDelta))} kredit
                  </span>
                </span>
                <span className="tnum shrink-0 font-bold">
                  {inv.amountIdr !== null ? fmtIdr(inv.amountIdr) : "—"}
                </span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                  Lunas
                </span>
                <button
                  onClick={() => setSelectedInvoice(inv)}
                  aria-label={`Lihat invoice ${inv.number}`}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white hover:brightness-110"
                >
                  Lihat Invoice
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Invoice ${selectedInvoice.number}`}
        >
          <div className="dw-rise max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[var(--surface-2)] p-6 shadow-2xl ring-1 ring-[var(--border)] sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-extrabold tracking-tight">
                  dadi<span className="text-[#2E6BFF]">web</span>
                </p>
                <p className="mt-0.5 font-mono text-xs text-[var(--dim)]">
                  {selectedInvoice.number}
                </p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400">
                LUNAS
              </span>
            </div>
            <dl className="mt-5 space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--dim)]">Tanggal</dt>
                <dd className="text-right font-semibold">
                  {new Date(selectedInvoice.createdAt).toLocaleDateString(
                    "id-ID",
                    { day: "numeric", month: "long", year: "numeric" },
                  )}{" "}
                  {new Date(selectedInvoice.createdAt).toLocaleTimeString(
                    "id-ID",
                    { hour: "2-digit", minute: "2-digit" },
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--dim)]">Pelanggan</dt>
                <dd className="text-right font-semibold">
                  {state.workspace.displayName}
                  <span className="block text-xs font-medium text-[var(--dim)]">
                    {state.workspace.email}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--dim)]">Item</dt>
                <dd className="text-right font-semibold">{selectedInvoice.title}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--dim)]">Metode pembayaran</dt>
                <dd className="text-right font-semibold">
                  DOKU (simulasi di prototipe)
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--dim)]">Perubahan kredit</dt>
                <dd className="tnum text-right font-semibold">
                  {selectedInvoice.creditsDelta > 0 ? "+" : selectedInvoice.creditsDelta < 0 ? "−" : ""}
                  {fmtNum(Math.abs(selectedInvoice.creditsDelta))} kredit
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--dim)]">Saldo setelah transaksi</dt>
                <dd className="tnum text-right font-semibold">
                  {selectedInvoice.balanceAfter !== null
                    ? `${fmtNum(selectedInvoice.balanceAfter)} kredit`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-[var(--border)] pt-3">
                <dt className="font-bold">Total bayar</dt>
                <dd className="tnum text-base font-extrabold">
                  {selectedInvoice.amountIdr !== null
                    ? fmtIdr(selectedInvoice.amountIdr)
                    : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-[var(--dim)]">
              Kuitansi ini diterbitkan otomatis dari buku besar kredit
              Dadiweb dan tertaut ke transaksi yang sama. Di prototipe ini
              pembayaran DOKU disimulasikan — tidak ada uang sungguhan yang
              ditarik.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => {
                  const inv = selectedInvoice;
                  downloadText(
                    `${inv.number.replace(/\//g, "-")}.txt`,
                    [
                      "DADIWEB — INVOICE",
                      `Nomor: ${inv.number}`,
                      `Tanggal: ${new Date(inv.createdAt).toLocaleString("id-ID")}`,
                      `Pelanggan: ${state.workspace.displayName} (${state.workspace.email})`,
                      `Item: ${inv.title}`,
                      "Metode: DOKU (simulasi di prototipe)",
                      `Perubahan kredit: ${inv.creditsDelta} kredit`,
                      `Saldo setelahnya: ${inv.balanceAfter ?? "-"} kredit`,
                      `Total bayar: ${inv.amountIdr !== null ? fmtIdr(inv.amountIdr) : "-"}`,
                      "Status: LUNAS",
                    ].join("\n"),
                    "text/plain",
                  );
                }}
                className="flex-1 rounded-xl bg-white/8 py-2.5 text-sm font-bold ring-1 ring-[var(--border)] transition hover:bg-white/12"
              >
                Unduh Kuitansi
              </button>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="flex-1 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] py-2.5 text-sm font-bold text-white hover:brightness-110"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="mt-5">
        <h2 className="text-lg font-bold">Beli Kredit</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {TOPUP_PACKS.map((pack) => (
            <article
              key={pack.label}
              className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5"
            >
              <p className="flex items-center gap-2 font-bold">
                <Icon name="bolt" size={17} className="text-amber-400" />
                {pack.label}
              </p>
              <p className="mt-2 text-2xl font-extrabold">{fmtIdr(pack.price)}</p>
              <p className="mt-1 text-xs text-[var(--dim)]">
                ≈ {fmtNum(pack.credits / 300)} website baru atau {fmtNum(pack.credits / 25)} kali deploy
              </p>
              <button
                onClick={() => topUp.mutate(pack)}
                disabled={topUp.isPending}
                className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
              >
                {topUp.isPending ? "Memproses…" : "Beli via DOKU (Simulasi)"}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-bold">Paket Langganan</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const active = state.account.plan === plan.name;
            return (
              <article
                key={plan.name}
                className={`rounded-3xl border p-5 ${
                  active
                    ? "border-[var(--accent)] bg-[var(--surface-2)]"
                    : "border-[var(--border-soft)] bg-[var(--surface)]"
                }`}
              >
                <p className="flex items-center justify-between font-bold">
                  {plan.name}
                  {active && (
                    <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[11px] font-bold text-white">
                      Paket Kamu
                    </span>
                  )}
                </p>
                <p className="mt-2 text-2xl font-extrabold">
                  {plan.price === 0 ? "Gratis" : fmtIdr(plan.price)}
                  {plan.price > 0 && (
                    <span className="text-sm font-medium text-[var(--dim)]"> / bulan</span>
                  )}
                </p>
                <p className="mt-1 text-[13px] font-semibold text-[#6EA8FF]">
                  {fmtNum(plan.credits)} kredit / bulan
                </p>
                <ul className="mt-3 space-y-1.5 text-[13px] text-[var(--dim)]">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-1.5">
                      <Icon name="check" size={13} className="text-emerald-400" /> {f}
                    </li>
                  ))}
                </ul>
                {active ? (
                  <p className="mt-4 text-xs leading-relaxed text-[var(--dim)]">
                    Ini paket yang sedang aktif di akunmu.
                  </p>
                ) : (
                  <button
                    onClick={() => changePlan.mutate(plan.name as "Free" | "Pro Plan" | "Bisnis")}
                    disabled={changePlan.isPending}
                    className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
                  >
                    {changePlan.isPending
                      ? "Memproses…"
                      : plan.credits > activePlan.credits
                        ? `Upgrade ke ${plan.name}`
                        : `Pindah ke ${plan.name}`}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
