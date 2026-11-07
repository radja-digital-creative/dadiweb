import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import {
Icon,
STAGE_META,
SitePreview,
SiteThumb,
downloadText,
fmtNum,
statusBadge,
timeAgo,
type Project,
type State,
} from "./lib";
import type { Nav } from "./views-main";
import { IsolationPanel } from "./isolation-panel";

// ---------------------------------------------------------------------------
// Proyek Saya
// ---------------------------------------------------------------------------

const PROJECT_FILTERS = ["Semua", "Website", "Aplikasi", "Draft", "Arsip"] as const;

export function ProjectsView({
  state,
  nav,
  token,
  initialFilter,
}: {
  state: State;
  nav: Nav;
  token: string;
  initialFilter?: string;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>(initialFilter ?? "Semua");
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);

  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, [initialFilter]);

  const setStatus = useMutation({
    mutationFn: (args: { projectId: number; status: "online" | "draft" | "archived" }) =>
      api.setProjectStatus({ token, ...args }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] }),
  });
  const deleteProject = useMutation({
    mutationFn: (projectId: number) => api.deleteProject({ token, projectId }),
    onSuccess: () => {
      setConfirmDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
    },
  });
  const duplicateProject = useMutation({
    mutationFn: (projectId: number) => api.duplicateProject({ token, projectId }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      nav.go("project", res.projectId);
    },
  });

  const counts = {
    Semua: state.projects.length,
    Website: state.projects.filter((p) => p.category !== "Aplikasi Android" && p.status !== "archived").length,
    Aplikasi: state.projects.filter((p) => p.category === "Aplikasi Android").length,
    Draft: state.projects.filter((p) => p.status === "draft").length,
    Arsip: state.projects.filter((p) => p.status === "archived").length,
  };

  const filtered = state.projects.filter((p) => {
    if (filter === "Website" && (p.category === "Aplikasi Android" || p.status === "archived")) return false;
    if (filter === "Aplikasi" && p.category !== "Aplikasi Android") return false;
    if (filter === "Draft" && p.status !== "draft") return false;
    if (filter === "Arsip" && p.status !== "archived") return false;
    if (filter === "Semua" && p.status === "archived") return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Proyek Saya</h1>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Kelola semua proyek website dan aplikasi kamu
          </p>
        </div>
        <button
          onClick={() => nav.go("create")}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
        >
          <Icon name="plus" size={16} /> Proyek Baru
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {PROJECT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
              filter === f
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] text-[var(--dim)] ring-1 ring-[var(--border-soft)] hover:text-white"
            }`}
          >
            {f} ({counts[f]})
          </button>
        ))}
        <label className="relative ml-auto block w-full sm:w-64">
          <span className="sr-only">Cari proyek</span>
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dim)]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari proyek…"
            className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] py-2 pl-9 pr-3 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-[var(--border)] p-10 text-center">
          <p className="font-bold">Tidak ada proyek di filter ini</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--dim)]">
            {search
              ? `Tidak ada proyek yang cocok dengan "${search}".`
              : "Buat proyek pertamamu dengan AI, atau mulai dari template."}
          </p>
          <button
            onClick={() => nav.go("create")}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white"
          >
            <Icon name="spark" size={15} /> Buat dengan AI
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const badge = statusBadge(p.status);
            return (
              <article
                key={p.id}
                className="overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)]"
              >
                <SiteThumb
                  hue={228}
                  primary={p.spec?.primaryColor}
                  className="w-full"
                />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-bold">{p.name}</h3>
                      <p className="text-xs text-[var(--dim)]">{p.category}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-[13px] text-[var(--dim)]">
                    {p.slug}.dadiweb.id
                  </p>
                  <p className="mt-1 text-xs text-[var(--dim)]">
                    Diubah {timeAgo(p.updatedAt)}
                    {p.source === "template" && " · Dari template"}
                    {p.source === "example" && " · Contoh desain"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => nav.go("project", p.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white hover:brightness-110"
                    >
                      <Icon name="edit" size={13} /> Buka
                    </button>
                    <button
                      onClick={() => nav.go("deploy", p.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12"
                    >
                      <Icon name="rocket" size={13} /> Deploy
                    </button>
                    <button
                      onClick={() => duplicateProject.mutate(p.id)}
                      disabled={duplicateProject.isPending}
                      aria-label={`Duplikat proyek ${p.name}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12 disabled:opacity-60"
                    >
                      <Icon name="folder" size={13} /> Duplikat
                    </button>
                    {p.status === "archived" ? (
                      <button
                        onClick={() =>
                          setStatus.mutate({ projectId: p.id, status: "draft" })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12"
                      >
                        Pulihkan
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          setStatus.mutate({ projectId: p.id, status: "archived" })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12"
                      >
                        <Icon name="archive" size={13} /> Arsip
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmDelete(p)}
                      aria-label={`Hapus proyek ${p.name}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
                    >
                      <Icon name="trash" size={13} /> Hapus
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi hapus proyek"
        >
          <div className="dw-rise w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h3 className="font-bold">Hapus proyek ini?</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
              Proyek <strong className="text-white">{confirmDelete.name}</strong>{" "}
              beserta database dan riwayat deploy-nya akan dihapus permanen.
              Kredit yang sudah terpakai tidak kembali.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-xl bg-white/8 py-2.5 text-sm font-bold hover:bg-white/12"
              >
                Batal
              </button>
              <button
                onClick={() => deleteProject.mutate(confirmDelete.id)}
                disabled={deleteProject.isPending}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-60"
              >
                {deleteProject.isPending ? "Menghapus…" : "Ya, Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const TEMPLATE_FILTERS = ["Semua", "Website", "Marketplace", "Sistem Bisnis", "Dashboard", "Aplikasi Android"];

export function TemplatesView({ state, nav, token }: { state: State; nav: Nav; token: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("Semua");
  const [search, setSearch] = useState("");

  const useTemplate = useMutation({
    mutationFn: (templateId: number) => api.createFromTemplate({ token, templateId }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      nav.go("project", res.projectId);
    },
  });

  const filtered = state.templates.filter((t) => {
    if (filter !== "Semua" && t.category !== filter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Template</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Mulai lebih cepat dari template — gratis, tanpa memotong kredit.
        Setelah dipilih, proyek langsung bisa diedit dan diubah AI.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {TEMPLATE_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
              filter === f
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] text-[var(--dim)] ring-1 ring-[var(--border-soft)] hover:text-white"
            }`}
          >
            {f}
          </button>
        ))}
        <label className="relative ml-auto block w-full sm:w-64">
          <span className="sr-only">Cari template</span>
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dim)]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari template…"
            className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] py-2 pl-9 pr-3 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-[var(--border)] p-10 text-center">
          <p className="font-bold">Template tidak ditemukan</p>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Coba kata kunci atau kategori lain — atau buat dari prompt saja.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => (
            <article
              key={t.id}
              className="overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)]"
            >
              <SiteThumb hue={t.hue} primary={t.spec.primaryColor} tall className="w-full" />
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold">
                    {t.name}{" "}
                    <span className="font-medium text-[var(--dim)]">· {t.tagline}</span>
                  </h3>
                  <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-[var(--dim)]">
                    {t.category}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-[var(--dim)]">
                  {t.spec.headline} — {t.spec.subheadline}
                </p>
                <p className="mt-2 text-xs text-[var(--dim)]">
                  Dipakai {fmtNum(t.uses)} kali
                </p>
                <button
                  onClick={() => useTemplate.mutate(t.id)}
                  disabled={useTemplate.isPending}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  {useTemplate.isPending ? "Membuat proyek…" : "Gunakan Template"}
                  <Icon name="arrow" size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor & Preview
// ---------------------------------------------------------------------------

function buildCodePreview(project: Project): string {
  const spec = project.spec;
  if (!spec) return "// Spesifikasi belum tersedia";
  const features = spec.features
    .map(
      (f) =>
        `  {\n    title: "${f.title}",\n    description: "${f.description}",\n  },`,
    )
    .join("\n");
  return `// ${spec.siteName} — dihasilkan pipeline AI Dadiweb
// Prompt: "${project.prompt.slice(0, 120)}"

import React from "react";

const site = {
  name: "${spec.siteName}",
  primaryColor: "${spec.primaryColor}",
  accentColor: "${spec.accentColor}",
  pages: [${spec.pages.map((p) => `"${p}"`).join(", ")}],
};

const features = [
${features}
];

export default function Home() {
  return (
    <main>
      <Hero
        headline="${spec.headline}"
        subheadline="${spec.subheadline}"
        cta="${spec.ctaLabel}"
      />
      <Features items={features} />
      {/* Sections: ${spec.sections.join(", ")} */}
    </main>
  );
}`;
}

export function EditorView({
  projectId,
  nav,
  token,
}: {
  projectId: number;
  nav: Nav;
  token: string;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"preview" | "code" | "files">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ siteName: "", headline: "", subheadline: "", ctaLabel: "" });
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [guardPath, setGuardPath] = useState("src/halaman-baru.tsx");
  const [guardSymlink, setGuardSymlink] = useState("");
  const [guardResult, setGuardResult] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["project-detail", projectId, token],
    queryFn: () => api.getProjectDetail({ token, projectId }),
  });

  const violations = useQuery({
    queryKey: ["path-violations", token],
    queryFn: () => api.getPathViolations({ token }),
    enabled: tab === "files",
  });

  const executeWrite = useMutation({
    mutationFn: () =>
      api.executeWrite({
        token,
        projectId,
        path: guardPath.trim(),
        symlinkTarget: guardSymlink.trim() || undefined,
      }),
    onSuccess: (res) => {
      setGuardResult(
        res.allowed
          ? `Lolos — tercatat sebagai file simulasi: ${res.resolvedPath}`
          : `Ditolak & tercatat sebagai percobaan pelanggaran — ${res.reason}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["project-detail"] });
      void queryClient.invalidateQueries({ queryKey: ["path-violations"] });
    },
    onError: (e) => setGuardResult(`Gagal menjalankan uji: ${String(e)}`),
  });

  const project = detail.data?.project ?? null;
  const spec = project?.spec ?? null;

  useEffect(() => {
    if (spec && !editing) {
      setForm({
        siteName: spec.siteName,
        headline: spec.headline,
        subheadline: spec.subheadline,
        ctaLabel: spec.ctaLabel,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, spec?.headline]);

  const save = useMutation({
    mutationFn: () =>
      api.updateProjectSpec({ token, projectId, ...form }),
    onSuccess: () => {
      setEditing(false);
      setSavedNote("Perubahan tersimpan — pratinjau sudah diperbarui.");
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      void queryClient.invalidateQueries({ queryKey: ["project-detail"] });
    },
  });

  const deploy = useMutation({
    mutationFn: () => api.deployProject({ token, projectId }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      void queryClient.invalidateQueries({ queryKey: ["project-detail"] });
      setSavedNote(
        res.ok
          ? `Deploy berhasil! Situs live di ${res.subdomain} (−25 kredit).`
          : (res.error ?? "Deploy gagal."),
      );
    },
  });

  if (detail.isPending) {
    return <p className="py-16 text-center text-sm text-[var(--dim)]">Memuat editor…</p>;
  }
  if (!project || !spec) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--border)] p-10 text-center">
        <p className="font-bold">Proyek tidak ditemukan</p>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Proyek ini mungkin sudah dihapus.
        </p>
        <button
          onClick={() => nav.go("projects")}
          className="mt-4 rounded-xl bg-white/8 px-4 py-2 text-sm font-bold hover:bg-white/12"
        >
          Kembali ke Proyek Saya
        </button>
      </div>
    );
  }

  const badge = statusBadge(project.status);
  const files = [
    { name: "src", indent: 0 },
    { name: "app", indent: 1 },
    ...spec.pages.map((p) => ({ name: `${p.toLowerCase().replace(/\s+/g, "-")}.tsx`, indent: 2 })),
    { name: "components", indent: 1 },
    { name: "hero.tsx", indent: 2 },
    { name: "features.tsx", indent: 2 },
    { name: "styles", indent: 0 },
    { name: "globals.css", indent: 1 },
    { name: "package.json", indent: 0 },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => nav.go("projects")}
          aria-label="Kembali ke Proyek Saya"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface)] ring-1 ring-[var(--border-soft)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="back" size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-extrabold tracking-tight">{project.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--dim)]">
            <span>{project.slug}.dadiweb.id</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>
              {badge.label}
            </span>
            {project.creditsCost > 0 && (
              <span>Dibuat dengan {project.creditsCost} kredit</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-sm font-bold hover:bg-white/12"
          >
            <Icon name="edit" size={15} /> Edit Konten
          </button>
          <button
            onClick={() => {
              downloadText(`${project.slug}.tsx`, buildCodePreview(project));
              setSavedNote("Kode diekspor sebagai file .tsx — unduhan dimulai.");
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-sm font-bold hover:bg-white/12"
          >
            <Icon name="download" size={15} /> Ekspor Kode
          </button>
          <button
            onClick={() => {
              downloadText(
                `${project.slug}-dadiweb.json`,
                JSON.stringify(
                  {
                    name: project.name,
                    slug: project.slug,
                    category: project.category,
                    prompt: project.prompt,
                    spec,
                    tables: (detail.data?.tables ?? []).map((t) => ({
                      name: t.name,
                      columns: t.columns,
                      rows: t.rows.map((r) => r.data),
                    })),
                    exportedFrom: "Dadiweb Editor",
                  },
                  null,
                  2,
                ),
                "application/json",
              );
              setSavedNote("Paket proyek diekspor (JSON: spesifikasi + data tabel).");
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-sm font-bold hover:bg-white/12"
          >
            <Icon name="download" size={15} /> Ekspor Proyek
          </button>
          <button
            onClick={() => deploy.mutate()}
            disabled={deploy.isPending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-3.5 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
          >
            <Icon name="rocket" size={15} />
            {deploy.isPending ? "Deploy…" : "Deploy"}
          </button>
        </div>
      </div>

      {project.prompt && (
        <p className="mt-3 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-[13px] leading-relaxed text-[var(--dim)]">
          <span className="font-bold text-white">Prompt: </span>“{project.prompt}”
        </p>
      )}

      {savedNote && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300"
        >
          {savedNote}
        </p>
      )}

      {/* G2 — Isolasi & Keamanan Proyek */}
      {detail.data && (
        <IsolationPanel projectId={projectId} token={token} slug={project.slug} />
      )}

      {/* G0 — Skill yang dipakai (baca-saja) */}
      {detail.data && (
        <section className="mt-4 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-[15px] font-bold">Skill yang dipakai</h2>
          {detail.data.skillPlan ? (
            <>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
                Domain utama:{" "}
                <span className="font-mono font-bold text-white">
                  {detail.data.skillPlan.primaryDomain ?? detail.data.skillPlan.label}
                </span>{" "}
                · ditentukan oleh{" "}
                {detail.data.skillPlan.winnerSource === "chip"
                  ? "chip pengguna (mengalahkan tebakan model)"
                  : detail.data.skillPlan.winnerSource === "klarifikasi"
                    ? "jawaban klarifikasi kamu"
                    : detail.data.skillPlan.winnerSource === "generik"
                      ? "mode generik (label: proyek kustom)"
                      : "skor kata kunci router"}
                . Blok ini baca-saja — tercatat saat proyek dibuat.
              </p>
              <div className="mt-3 space-y-1.5">
                {(
                  [
                    ["planner", "Planner"],
                    ["designer", "Designer"],
                    ["coder", "Coder"],
                    ["builder", "Builder & Tester"],
                    ["fixer", "Fixer"],
                  ] as const
                ).map(([key, label]) => (
                  <p key={key} className="flex flex-wrap items-center gap-1.5 text-[13px]">
                    <span className="w-32 shrink-0 font-bold">{label}</span>
                    {detail.data!.skillPlan!.stages[key].map((s) => (
                      <span key={s} className="rounded-md bg-white/8 px-2 py-0.5 font-mono text-xs">
                        {s}
                      </span>
                    ))}
                  </p>
                ))}
              </div>
              <ul className="mt-3 space-y-1 border-t border-[var(--border-soft)] pt-3">
                {detail.data.skillVersions.map((v) => (
                  <li key={v.name} className="text-xs text-[var(--dim)]">
                    <span className="font-mono text-slate-200">{v.name}</span> · versi
                    katalog {v.version} · {v.note}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--dim)]">
                Sejak G1, versi di atas adalah versi file SKILL.md asli di
                katalog prototipe (aksi listSkills/getSkill). Proyek lama dari
                masa G0 tetap menampilkan label versi yang tercatat saat itu.
              </p>
            </>
          ) : (
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
              Proyek ini dibuat sebelum katalog skill (tanpa skill_plan) —
              proyek yang dibuat lewat Buat dengan AI setelah G0 akan mencatat
              skill per tahapnya di sini.
            </p>
          )}
        </section>
      )}

      {editing && (
        <form
          className="dw-rise mt-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h2 className="text-[15px] font-bold">Edit Konten Situs</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Nama situs</span>
              <input
                value={form.siteName}
                onChange={(e) => setForm({ ...form, siteName: e.target.value })}
                required
                maxLength={80}
                className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Teks tombol utama (CTA)</span>
              <input
                value={form.ctaLabel}
                onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
                required
                maxLength={60}
                className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Headline hero</span>
              <input
                value={form.headline}
                onChange={(e) => setForm({ ...form, headline: e.target.value })}
                required
                maxLength={160}
                className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Subheadline hero</span>
              <textarea
                value={form.subheadline}
                onChange={(e) => setForm({ ...form, subheadline: e.target.value })}
                required
                maxLength={400}
                rows={2}
                className="w-full resize-none rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
          </div>
          {save.isError && (
            <p role="alert" className="mt-3 text-sm text-rose-300">
              Gagal menyimpan: {String(save.error)}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {save.isPending ? "Menyimpan…" : "Simpan Perubahan"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-xl bg-white/8 px-4 py-2 text-sm font-bold hover:bg-white/12"
            >
              Batal
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-3 py-2.5">
          <div className="flex rounded-lg bg-[#0A1130] p-1" role="tablist" aria-label="Mode editor">
            {(
              [
                { key: "preview", label: "Preview", icon: "eye" },
                { key: "code", label: "Kode", icon: "code" },
                { key: "files", label: "File", icon: "folder" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-bold transition ${
                  tab === t.key ? "bg-[var(--accent)] text-white" : "text-[var(--dim)] hover:text-white"
                }`}
              >
                <Icon name={t.icon} size={14} /> {t.label}
              </button>
            ))}
          </div>
          {tab === "preview" && (
            <div className="ml-auto flex rounded-lg bg-[#0A1130] p-1" role="group" aria-label="Ukuran pratinjau">
              <button
                onClick={() => setDevice("desktop")}
                aria-pressed={device === "desktop"}
                className={`rounded-md px-3 py-1.5 text-[13px] font-bold ${device === "desktop" ? "bg-white/12 text-white" : "text-[var(--dim)]"}`}
              >
                Desktop
              </button>
              <button
                onClick={() => setDevice("mobile")}
                aria-pressed={device === "mobile"}
                className={`rounded-md px-3 py-1.5 text-[13px] font-bold ${device === "mobile" ? "bg-white/12 text-white" : "text-[var(--dim)]"}`}
              >
                Mobile
              </button>
            </div>
          )}
          <span className="ml-auto hidden items-center gap-1.5 text-xs text-[var(--dim)] sm:inline-flex">
            <Icon name="globe" size={13} /> {project.slug}.dadiweb.id
          </span>
        </div>

        {tab === "preview" && (
          <div className="bg-[#0A1130] p-3 sm:p-5">
            <div
              className={`mx-auto overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 transition-all ${
                device === "mobile" ? "max-w-[380px]" : "max-w-full"
              }`}
            >
              <SitePreview spec={spec} compact={device === "mobile"} />
            </div>
          </div>
        )}

        {tab === "code" && (
          <pre className="overflow-x-auto bg-[#05081A] p-4 text-[12.5px] leading-relaxed text-[#A5B4FC]">
            <code>{buildCodePreview(project)}</code>
          </pre>
        )}

        {tab === "files" && (
          <div className="grid sm:grid-cols-[220px_1fr]">
            <ul className="border-b border-[var(--border-soft)] p-3 sm:border-b-0 sm:border-r">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[13px] text-[var(--dim)]"
                  style={{ paddingLeft: `${8 + f.indent * 16}px` }}
                >
                  <Icon name={f.name.includes(".") ? "code" : "folder"} size={13} />
                  {f.name}
                </li>
              ))}
            </ul>
            <div className="p-4">
              <p className="text-sm font-bold">Struktur proyek</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
                {spec.pages.length} halaman dihasilkan AI: {spec.pages.join(", ")}.
                Database proyek ini memiliki {detail.data?.tables.length ?? 0}{" "}
                tabel — kelola di menu Database. Gunakan tombol Ekspor Kode /
                Ekspor Proyek di atas untuk mengunduh hasil generate ini.
              </p>

              {(detail.data?.files.length ?? 0) > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-bold">File simulasi (lolos path-guard)</p>
                  <ul className="mt-1.5 space-y-1">
                    {detail.data!.files.map((f) => (
                      <li key={f.id} className="font-mono text-xs text-[var(--dim)]">
                        {f.path}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5 border-t border-[var(--border-soft)] pt-4">
                <p className="text-sm font-bold">Uji Executor Path-Guard (I-4, G0)</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
                  Setiap penulisan file proyek wajib berada di pohon tenant
                  milikmu:{" "}
                  <span className="font-mono">tenants/&lt;user_id&gt;/{projectId}/</span>.
                  Coba path seperti{" "}
                  <span className="font-mono">../rahasia.txt</span>,{" "}
                  <span className="font-mono">/etc/passwd</span>, atau path
                  tenant lain — guard akan menolak, mencatatnya sebagai
                  percobaan pelanggaran, dan tidak ada tulisan yang terjadi.
                </p>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">
                    Path file yang diuji
                  </span>
                  <input
                    value={guardPath}
                    onChange={(e) => setGuardPath(e.target.value)}
                    aria-label="Path file yang diuji path-guard"
                    className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 font-mono text-[13px] text-white focus:border-[var(--accent)] focus:outline-none"
                  />
                </label>
                <label className="mt-2 block">
                  <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">
                    Target symlink (opsional, untuk pengujian)
                  </span>
                  <input
                    value={guardSymlink}
                    onChange={(e) => setGuardSymlink(e.target.value)}
                    aria-label="Target symlink untuk pengujian path-guard"
                    placeholder="mis. /etc/passwd"
                    className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 font-mono text-[13px] text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </label>
                <button
                  onClick={() => executeWrite.mutate()}
                  disabled={!guardPath.trim() || executeWrite.isPending}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/8 px-4 py-2 text-sm font-bold hover:bg-white/12 disabled:opacity-50"
                >
                  <Icon name="shield" size={15} />
                  {executeWrite.isPending ? "Memeriksa…" : "Uji Tulis (Path-Guard)"}
                </button>
                {guardResult && (
                  <p role="status" className="mt-3 rounded-xl bg-white/5 px-3.5 py-2.5 text-[13px] leading-relaxed">
                    {guardResult}
                  </p>
                )}
                {(violations.data?.violations.length ?? 0) > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-bold">
                      Percobaan pelanggaran tercatat ({violations.data!.violations.length})
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {violations.data!.violations.slice(0, 6).map((v) => (
                        <li key={v.id} className="rounded-lg bg-rose-500/8 px-3 py-2 text-xs leading-relaxed text-rose-200">
                          <span className="font-mono font-bold">{v.path}</span> — {v.reason}
                          <span className="block text-rose-300/70">{timeAgo(v.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pipeline history */}
      {detail.data && detail.data.generations.length > 0 && (
        <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-[15px] font-bold">Riwayat Pipeline AI</h2>
          <ol className="mt-3 space-y-2">
            {detail.data.generations.map((g) => {
              const meta = STAGE_META.find((s) => s.key === g.stage);
              return (
                <li
                  key={g.id}
                  className="flex items-start gap-3 rounded-xl bg-white/4 px-3.5 py-2.5"
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${
                      g.status === "done" ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  >
                    <Icon name={g.status === "done" ? "check" : "x"} size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-bold">
                      {meta?.label ?? g.stage}
                    </span>
                    <span className="block text-xs leading-relaxed text-[var(--dim)]">
                      {g.note}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-xs text-[var(--dim)]">
                    {g.credits > 0 ? `−${g.credits} kredit` : "gratis"} ·{" "}
                    {timeAgo(g.createdAt)}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
