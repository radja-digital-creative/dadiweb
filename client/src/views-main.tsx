import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import heroImg from "./assets/hero.webp";
import {
CATEGORY_CHIPS,
CreditDonut,
EXAMPLE_PROMPTS,
Icon,
STAGE_META,
SiteThumb,
UsageLegend,
fmtNum,
statusBadge,
timeAgo,
type Project,
type State,
type View,
} from "./lib";

export interface Nav {
  go: (view: View, projectId?: number) => void;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const FEATURE_CARDS = [
  {
    view: "create" as View,
    icon: "spark",
    color: "#2E6BFF",
    bg: "rgba(46,107,255,0.14)",
    title: "Website dari Prompt",
    desc: "Buat website lengkap dengan desain modern",
  },
  {
    view: "android" as View,
    icon: "phone",
    color: "#22C55E",
    bg: "rgba(34,197,94,0.13)",
    title: "Aplikasi Android",
    desc: "Ubah proyek menjadi aplikasi Android",
  },
  {
    view: "database" as View,
    icon: "db",
    color: "#A78BFA",
    bg: "rgba(124,77,255,0.15)",
    title: "Database Otomatis",
    desc: "Buat tabel, relasi, dan kelola data dengan AI",
  },
  {
    view: "deploy" as View,
    icon: "rocket",
    color: "#F97316",
    bg: "rgba(249,115,22,0.13)",
    title: "Deploy Sekali Klik",
    desc: "Publikasikan ke internet dengan mudah",
  },
];

export function DashboardView({
  state,
  nav,
  onPrompt,
}: {
  state: State;
  nav: Nav;
  onPrompt: (text: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [chip, setChip] = useState("Website");
  const current = state.projects.find((p) => p.status === "online") ?? state.projects[0];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {/* Hero composer */}
        <section className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-gradient-to-br from-[#141D4D] via-[#101736] to-[#0A1030] p-5 sm:p-8">
          <img
            src={heroImg}
            alt=""
            className="pointer-events-none absolute -right-10 -top-6 hidden w-[46%] max-w-[420px] opacity-90 md:block"
            style={{
              maskImage: "linear-gradient(to left, black 55%, transparent)",
              WebkitMaskImage: "linear-gradient(to left, black 55%, transparent)",
            }}
          />
          <div className="relative md:max-w-[58%]">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Punya Ide?
              <br />
              Website dan Aplikasi Jadi!
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)] sm:text-[15px]">
              Dadiweb membantu kamu membuat website, aplikasi, dan sistem bisnis
              dengan AI. Cukup ketik perintah, sisanya biar AI yang kerjakan.
            </p>
            {(
              <div className="mt-5 flex flex-wrap gap-2">
                {CATEGORY_CHIPS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setChip(c)}
                    aria-pressed={chip === c}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                      chip === c
                        ? "bg-[var(--accent)] text-white"
                        : "bg-white/8 text-slate-200 hover:bg-white/15"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative mt-3 rounded-2xl border border-[var(--border)] bg-[#0A1130]/90 p-3 sm:p-4">
            <label htmlFor="dash-prompt" className="sr-only">
              Deskripsikan website atau aplikasi yang ingin kamu buat
            </label>
            <textarea
              id="dash-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Deskripsikan website atau aplikasi yang ingin kamu buat…"
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-white placeholder:text-[var(--dim-2)] focus:outline-none disabled:opacity-60"
            />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-1.5 text-xs text-[var(--dim)]">
                  <Icon name="attach" size={14} /> Lampirkan referensi
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-1.5 text-xs text-[var(--dim)]">
                  <Icon name="spark" size={14} /> Mode: Auto
                </span>
                <span className="ml-auto text-xs text-[var(--dim-2)] tnum">
                  Biaya generate: {state.generateCost} kredit
                </span>
                <button
                  onClick={() => onPrompt(prompt)}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/50 transition hover:brightness-110 active:scale-[0.98]"
                >
                  Buat dengan AI <Icon name="arrow" size={16} />
                </button>
              </div>
          </div>
        </section>

        {/* Feature cards */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Fitur utama">
          {FEATURE_CARDS.map((f) => (
            <button
              key={f.title}
              onClick={() => nav.go(f.view)}
              className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--border)] hover:bg-[var(--surface-2)]"
            >
              <span
                className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: f.bg, color: f.color }}
              >
                <Icon name={f.icon} size={20} />
              </span>
              <span className="block text-sm font-bold">{f.title}</span>
              <span className="mt-1 block text-xs leading-relaxed text-[var(--dim)]">
                {f.desc}
              </span>
            </button>
          ))}
        </section>

        {/* Templates */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Template Populer</h2>
            <button
              onClick={() => nav.go("templates")}
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#6EA8FF] hover:underline"
            >
              Lihat Semua <Icon name="arrow" size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {state.templates.map((t) => (
              <button
                key={t.id}
                onClick={() => nav.go("templates")}
                className="group text-left"
              >
                <SiteThumb
                  hue={t.hue}
                  primary={t.spec.primaryColor}
                  className="rounded-xl ring-1 ring-white/10 transition group-hover:ring-white/30"
                />
                <span className="mt-2 block text-[13px] font-bold leading-tight">
                  {t.name}
                </span>
                <span className="block text-xs text-[var(--dim)]">{t.tagline}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Recent projects */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Proyek Terbaru</h2>
            <button
              onClick={() => nav.go("projects")}
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#6EA8FF] hover:underline"
            >
              Lihat Semua <Icon name="arrow" size={14} />
            </button>
          </div>
          {state.projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center">
              <p className="font-semibold">Belum ada proyek</p>
              <p className="mt-1 text-sm text-[var(--dim)]">
                Tulis idemu di composer di atas, dan AI akan membangun website
                pertamamu.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {state.projects.slice(0, 4).map((p) => (
                <ProjectMiniCard key={p.id} project={p} nav={nav} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Right rail */}
      <aside className="space-y-5">
        <section className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <h2 className="mb-4 text-[15px] font-bold">Penggunaan Kredit</h2>
          <div className="flex flex-col items-center gap-4">
            <CreditDonut
              usage={state.usage}
              balance={state.account.balance}
              quota={state.account.monthlyQuota}
            />
            <div className="w-full">
              <UsageLegend usage={state.usage} quota={state.account.monthlyQuota} />
            </div>
          </div>
          <button
            onClick={() => nav.go("credits")}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] py-2.5 text-sm font-bold text-white transition hover:brightness-110"
          >
            <Icon name="plus" size={16} /> Beli Kredit
          </button>
        </section>

        {current && (
          <section className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
            <h2 className="mb-3 text-[15px] font-bold">Proyek Saat Ini</h2>
            <div className="flex items-center gap-3">
              <SiteThumb
                hue={225}
                primary={current.spec?.primaryColor}
                className="w-20 shrink-0 rounded-lg"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{current.name}</p>
                <p className="text-xs text-[var(--dim)]">{current.category}</p>
                <span
                  className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusBadge(current.status).cls}`}
                >
                  {statusBadge(current.status).label}
                </span>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-[var(--dim)]">
              {current.slug}.dadiweb.id
              <Icon name="ext" size={13} className="text-[#6EA8FF]" />
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => nav.go("editor", current.id)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/8 py-2 text-[13px] font-semibold hover:bg-white/12"
              >
                <Icon name="edit" size={14} /> Edit
              </button>
              <button
                onClick={() => nav.go("editor", current.id)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/8 py-2 text-[13px] font-semibold hover:bg-white/12"
              >
                <Icon name="eye" size={14} /> Preview
              </button>
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <h2 className="mb-3 text-[15px] font-bold">Quick Tools</h2>
          <ul className="space-y-1">
            {[
              { view: "create" as View, icon: "edit", color: "#7C4DFF", title: "Editor Visual", desc: "Edit tampilan dengan drag & drop" },
              { view: "database" as View, icon: "db", color: "#2E6BFF", title: "Kelola Database", desc: "Lihat dan edit data" },
              { view: "deploy" as View, icon: "globe", color: "#22C55E", title: "Hubungkan Domain", desc: "Gunakan domain sendiri" },
              { view: "deploy" as View, icon: "rocket", color: "#F97316", title: "Deploy Sekarang", desc: "Publikasikan perubahan" },
              { view: "integrations" as View, icon: "link", color: "#A78BFA", title: "Integrasi API", desc: "DOKU, WhatsApp, Maps & lainnya" },
            ].map((tool) => (
              <li key={tool.title}>
                <button
                  onClick={() => nav.go(tool.view)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/5"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ background: tool.color }}
                  >
                    <Icon name={tool.icon} size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{tool.title}</span>
                    <span className="block truncate text-xs text-[var(--dim)]">
                      {tool.desc}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <h2 className="mb-3 text-[15px] font-bold">Bantuan &amp; Panduan</h2>
          <button
            onClick={() => nav.go("help")}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2E6BFF] text-white">
              <Icon name="book" size={17} />
            </span>
            <span>
              <span className="block text-sm font-semibold">Panduan Lengkap</span>
              <span className="block text-xs text-[var(--dim)]">
                Pelajari cara menggunakan Dadiweb
              </span>
            </span>
          </button>
          <button
            onClick={() => nav.go("create")}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0EA5E9] text-white">
              <Icon name="chat" size={17} />
            </span>
            <span>
              <span className="block text-sm font-semibold">Tanya AI Assistant</span>
              <span className="block text-xs text-[var(--dim)]">
                Dapatkan bantuan langsung
              </span>
            </span>
          </button>
        </section>
      </aside>
    </div>
  );
}

export function ProjectMiniCard({ project, nav }: { project: Project; nav: Nav }) {
  const badge = statusBadge(project.status);
  return (
    <article className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-3">
      <div className="flex items-start gap-3">
        <SiteThumb
          hue={228}
          primary={project.spec?.primaryColor}
          className="w-16 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{project.name}</p>
          <p className="truncate text-xs text-[var(--dim)]">
            {project.slug}.dadiweb.id
          </p>
          <span
            className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
          >
            {badge.label}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[var(--dim)]">
          Diubah {timeAgo(project.updatedAt)}
        </span>
        <button
          onClick={() => nav.go("editor", project.id)}
          className="text-xs font-bold text-[#6EA8FF] hover:underline"
        >
          Buka Editor
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Buat dengan AI (Prompt Builder + pipeline progress)
// ---------------------------------------------------------------------------

type GenStage = {
  stage: string;
  label: string;
  status: string;
  credits: number;
  note: string;
};

type RoutePreview = ApiResponse<typeof api, "previewSkillRoute">;
type SkillValidation = ApiResponse<typeof api, "validateSkill">;

// G0 — pilihan chip skill untuk Router v1. Chip yang dipilih pengguna selalu
// mengalahkan tebakan skor router.
const SKILL_CHIPS: Array<{ value: string; label: string }> = [
  { value: "", label: "Auto (tanpa chip)" },
  { value: "landing-page", label: "Landing Page" },
  { value: "company-profile", label: "Company Profile" },
  { value: "toko-online", label: "Toko Online" },
  { value: "pos-kasir", label: "POS Kasir" },
  { value: "booking-reservasi", label: "Booking & Reservasi" },
  { value: "android-developer", label: "Aplikasi Android" },
  { value: "dashboard-admin", label: "Dashboard Admin" },
  { value: "marketplace", label: "Marketplace" },
];

const STAGE_LABELS: Array<{ key: keyof RoutePreview["stages"]; label: string }> = [
  { key: "planner", label: "Planner" },
  { key: "designer", label: "Designer" },
  { key: "coder", label: "Coder" },
  { key: "builder", label: "Builder & Tester" },
  { key: "fixer", label: "Fixer" },
];

function winnerText(source: string): string {
  if (source === "chip") return "Chip pengguna (mengalahkan tebakan model)";
  if (source === "klarifikasi") return "Jawaban klarifikasi kamu";
  if (source === "generik") return "Mode generik — tidak ada skill yang cocok";
  return "Skor kata kunci tertinggi";
}

function RouteStages({ preview }: { preview: RoutePreview }) {
  return (
    <div className="space-y-1.5">
      {STAGE_LABELS.map(({ key, label }) => (
        <p key={key} className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="w-32 shrink-0 font-bold">{label}</span>
          {preview.stages[key].length === 0 ? (
            <span className="text-[var(--dim)]">—</span>
          ) : (
            preview.stages[key].map((s) => (
              <span
                key={s}
                className="rounded-md bg-white/8 px-2 py-0.5 font-mono text-xs"
              >
                {s}
              </span>
            ))
          )}
        </p>
      ))}
    </div>
  );
}

export function CreateView({
  state,
  nav,
  token,
  initialPrompt,
  consumeInitialPrompt,
}: {
  state: State;
  nav: Nav;
  token: string;
  initialPrompt: string;
  consumeInitialPrompt: () => void;
}) {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [chip, setChip] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [liveStages, setLiveStages] = useState<GenStage[] | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [doneProjectId, setDoneProjectId] = useState<number | null>(null);
  const [clarifyQ, setClarifyQ] = useState<string | null>(null);
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [routeDone, setRouteDone] = useState<{
    label: string;
    winnerSource: string;
    versions: Array<{ name: string; version: string }>;
  } | null>(null);
  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [skillText, setSkillText] = useState("");
  const [validation, setValidation] = useState<SkillValidation | null>(null);
  const [catalog, setCatalog] = useState<Array<{
    name: string;
    family: string;
    title: string;
    version: string;
  }> | null>(null);
  const [skillDoc, setSkillDoc] = useState<{
    name: string;
    content: string;
    error: string | null;
  } | null>(null);
  const resultRef = useRef<{ stages: GenStage[]; projectId: number | null } | null>(null);

  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
      consumeInitialPrompt();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const previewRoute = useMutation({
    mutationFn: () =>
      api.previewSkillRoute({
        prompt: prompt.trim(),
        chip: chip || undefined,
        clarificationAnswer: clarifyAnswer.trim() || undefined,
      }),
    onSuccess: (res) => setPreview(res),
  });

  const validateSkillText = useMutation({
    mutationFn: () => api.validateSkill({ content: skillText }),
    onSuccess: (res) => setValidation(res),
  });

  const loadCatalog = useMutation({
    mutationFn: () => api.listSkills({}),
    onSuccess: (res) => setCatalog(res.skills),
  });

  const loadSkillDoc = useMutation({
    mutationFn: (name: string) => api.getSkill({ name }),
    onSuccess: (res) =>
      setSkillDoc({ name: res.name, content: res.content, error: res.error }),
  });

  // G6 — composer "Buat dengan AI" TIDAK LAGI selalu menjalankan
  // generate. Pesan lewat sendChatMessage (klasifikasi): sapaan/vague
  // dan tanya/diskusi → proyek draft GRATIS + balasan, tanpa potongan;
  // brief build yang jelas → pipeline spesialis dengan reveal tahap +
  // auto-nav seperti generate dulu. Jalur generateWebsite lama tidak
  // lagi dipanggil dari composer.
  const sendChat = useMutation({
    mutationFn: (vars: { text: string; clarificationAnswer?: string }) =>
      api.sendChatMessage({
        token,
        prompt: vars.text,
        chip: chip || undefined,
        clarificationAnswer: vars.clarificationAnswer,
      }),
    onMutate: () => {
      setError(null);
      setDoneProjectId(null);
      setRouteDone(null);
      setLiveStages([]);
      setVisibleCount(0);
      resultRef.current = null;
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      // Router butuh klarifikasi: build belum berjalan, tidak ada
      // kredit terpotong — tampilkan tepat satu pertanyaannya.
      if (res.routeStatus === "needs_clarification") {
        setClarifyQ(res.clarificationQuestion);
        setError(null);
        setLiveStages(null);
        return;
      }
      setClarifyQ(null);
      if (res.skillPlan) {
        setRouteDone({
          label: res.skillPlan.label,
          winnerSource: res.skillPlan.winnerSource,
          versions: res.skillVersions.map((v) => ({ name: v.name, version: v.version })),
        });
      }
      if (!res.ok) {
        setError(res.error ?? "Pesan gagal diproses. Coba lagi.");
        setLiveStages(res.stages);
        setVisibleCount(res.stages.length);
        return;
      }
      // Sapaan/tanya/diskusi: langsung masuk ke chat proyek itu
      // (tanpa reveal pipeline — tidak ada tahap build).
      if (res.intent !== "build") {
        if (res.projectId) {
          setDoneProjectId(res.projectId);
          nav.go("project", res.projectId);
        }
        return;
      }
      resultRef.current = { stages: res.stages, projectId: res.projectId };
      setLiveStages([]);
      setVisibleCount(0);
    },
    onError: (e) => {
      setError(String(e instanceof Error ? e.message : e));
      setLiveStages(null);
    },
  });

  // Reveal finished stages one by one so the pipeline feels alive, then
  // reveal the success card.
  useEffect(() => {
    if (!sendChat.isPending && resultRef.current) {
      const total = resultRef.current.stages.length;
      if (visibleCount < total) {
        const t = setTimeout(() => {
          setLiveStages(resultRef.current?.stages.slice(0, visibleCount + 1) ?? []);
          setVisibleCount((c) => c + 1);
        }, 650);
        return () => clearTimeout(t);
      }
      if (resultRef.current.projectId) {
        // Build sukses → OTOMATIS masuk ke tampilan project (chat),
        // bukan berhenti di kartu sukses. Kartu sukses tetap dipertahankan
        // sebagai fallback bila navigasi tidak meng-unmount halaman ini.
        const doneId = resultRef.current.projectId;
        setDoneProjectId(doneId);
        resultRef.current = null;
        nav.go("project", doneId);
      }
    }
    return undefined;
  }, [sendChat.isPending, visibleCount]);

  const busy = sendChat.isPending || (liveStages !== null && doneProjectId === null && !error);
  const canAfford = state.account.balance >= state.generateCost;
  // G6 — ambang diturunkan agar sapaan ("halo") bisa dikirim dari
  // composer; klasifikasi server yang memutuskan build vs chat.
  const tooShort = prompt.trim().length < 2;

  const workingStages: GenStage[] =
    liveStages ??
    (sendChat.isPending
      ? STAGE_META.slice(0, 2).map((s, i) => ({
          stage: s.key,
          label: s.label,
          status: i === 0 ? "done" : "done",
          credits: s.cost,
          note: s.desc,
        }))
      : []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Buat dengan AI</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Cukup jelaskan ide kamu, AI akan membuat website atau aplikasi secara
        lengkap. Sapaan dan diskusi 5 kredit per balasan — AI perencana
        akan menyusun rencananya dulu; build dimulai saat kamu memberi
        perintah build, atau otomatis setelah diskusi secukupnya.
      </p>

      <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
        <label htmlFor="create-prompt" className="sr-only">
          Prompt website atau aplikasi
        </label>
        <textarea
          id="create-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          maxLength={2000}
          disabled={busy}
          placeholder="Contoh: halo — atau: Buatkan marketplace seperti Shopee untuk jual beli HP dengan fitur chat AI, pembayaran DOKU, dan sistem langganan toko."
          className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[#0A1130] p-4 text-[15px] leading-relaxed text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-[var(--dim)]">
          <span>
            {tooShort && prompt.length > 0
              ? "Minimal 2 karakter"
              : "Semakin detail prompt, semakin bagus hasilnya — sapaan dan diskusi 5 kredit per balasan, build 300 kredit bila berhasil"}
          </span>
          <span className="tnum">{prompt.length}/2000</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--dim)]">
            Chip skill
            <select
              aria-label="Chip jenis proyek (skill router)"
              value={chip}
              onChange={(e) => setChip(e.target.value)}
              disabled={busy}
              className="rounded-lg border border-[var(--border)] bg-[#0A1130] px-2.5 py-2 text-sm font-semibold text-white focus:outline-none"
            >
              {SKILL_CHIPS.map((c) => (
                <option key={c.label} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-2 text-xs text-[var(--dim)]">
            <Icon name="upload" size={14} /> Upload Referensi
          </span>
          <span className="text-xs text-[var(--dim)]">
            Saldo:{" "}
            <strong className="text-white tnum">{fmtNum(state.account.balance)}</strong>{" "}
            kredit · Tanya/diskusi 5 kredit/balasan · Build: {state.generateCost} kredit
          </span>
          <button
            onClick={() => sendChat.mutate({ text: prompt.trim() })}
            disabled={busy || tooShort}
            className="ml-auto inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/50 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "AI Sedang Memproses…" : "Kirim"} <Icon name="arrow" size={16} />
          </button>
        </div>

        {clarifyQ && !busy && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-bold text-amber-200">
              Router skill butuh satu klarifikasi — build belum berjalan dan
              belum ada kredit terpotong.
            </p>
            <p className="mt-1 text-sm text-amber-100">{clarifyQ}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="clarify-answer">
                Jawaban klarifikasi
              </label>
              <input
                id="clarify-answer"
                value={clarifyAnswer}
                onChange={(e) => setClarifyAnswer(e.target.value)}
                placeholder="Jawaban kamu, mis. satu penjual saja"
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                onClick={() =>
                  sendChat.mutate({
                    text: prompt.trim(),
                    clarificationAnswer: clarifyAnswer.trim(),
                  })
                }
                disabled={!clarifyAnswer.trim() || tooShort}
                className="rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Jawab &amp; Kirim
              </button>
            </div>
          </div>
        )}

        {!canAfford && !busy && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Kredit kamu tidak cukup untuk build ({state.generateCost}{" "}
            kredit) — tapi sapaan dan diskusi tetap bisa (5 kredit per
            balasan).{" "}
            <button
              onClick={() => nav.go("credits")}
              className="font-bold underline underline-offset-2"
            >
              Top up kredit
            </button>{" "}
            dulu yuk bila ingin build.
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
          >
            {error}
          </div>
        )}
      </section>

      {/* Katalog Skill — G0 fondasi + G1 file SKILL.md lengkap */}
      <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
        <h2 className="text-[15px] font-bold">Katalog Skill AI — Router v1 &amp; SKILL.md</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
          Router v1 memilih skill per tahap pipeline dari katalog. Katalog
          kini berisi{" "}
          <strong className="text-slate-200">30 file SKILL.md lengkap</strong>{" "}
          (12 P0 dari gelombang G1 + 16 P1 dari gelombang G3 + 2 P2 dari
          gelombang G4) — bukan hanya metadata.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => previewRoute.mutate()}
            disabled={tooShort || previewRoute.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-white/8 px-4 py-2 text-sm font-bold hover:bg-white/12 disabled:opacity-50"
          >
            <Icon name="spark" size={15} />
            {previewRoute.isPending ? "Menghitung…" : "Pratinjau Routing Skill"}
          </button>
          <span className="inline-flex items-center text-xs text-[var(--dim)]">
            Pratinjau tidak memotong kredit dan tidak membuat proyek.
          </span>
        </div>
        {previewRoute.isError && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            Pratinjau gagal: {String(previewRoute.error)}
          </p>
        )}
        {preview && (
          <div className="dw-rise mt-4 rounded-2xl border border-[var(--border-soft)] bg-[#0A1130] p-4">
            {preview.status === "needs_clarification" ? (
              <>
                <p className="text-sm font-bold text-amber-300">
                  Status: needs_clarification — router tidak menebak.
                </p>
                <p className="mt-1 text-sm">{preview.clarificationQuestion}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold">
                  Domain utama:{" "}
                  <span className="font-mono">{preview.primaryDomain ?? "—"}</span>{" "}
                  <span className="font-medium text-[var(--dim)]">
                    ({preview.status === "generic" ? "label: proyek kustom" : `label: ${preview.label}`})
                  </span>
                </p>
                <p className="mt-1 text-[13px] text-[var(--dim)]">
                  Pemenang: {winnerText(preview.winnerSource)}
                  {preview.guessedSkill
                    ? ` · tebakan skor: ${preview.guessedSkill}`
                    : " · tebakan skor: tidak ada yang cocok"}
                  {preview.chipSkill ? ` · chip: ${preview.chipSkill}` : ""}
                  {" "}· maksimal {preview.maxSkillsPerStage} skill per tahap ·
                  aturan platform (isolasi &amp; keamanan) selalu menang atas
                  skill domain.
                </p>
                <div className="mt-3">
                  <RouteStages preview={preview} />
                </div>
                <p className="mt-3 text-[13px] text-[var(--dim)]">
                  Skor domain:{" "}
                  {preview.scores
                    .filter((s) => s.score > 0)
                    .map((s) => `${s.skill} ${s.score}`)
                    .join(" · ") || "semua 0"}
                </p>
                <p className="mt-1 text-xs text-[var(--dim)]">{preview.note}</p>
              </>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-[var(--border-soft)] pt-4">
          <h3 className="text-sm font-bold">Validator SKILL.md (format baku Bab 3)</h3>
          <p className="mt-1 text-[13px] text-[var(--dim)]">
            Tempel teks SKILL.md lengkap untuk memeriksa frontmatter wajib dan
            10 bagian wajibnya. Validator hanya memeriksa — tidak menyimpan
            apa pun.
          </p>
          <label className="sr-only" htmlFor="skill-md-text">
            Teks SKILL.md yang akan divalidasi
          </label>
          <textarea
            id="skill-md-text"
            value={skillText}
            onChange={(e) => setSkillText(e.target.value)}
            rows={6}
            placeholder={"---\nname: contoh-skill\nversion: 1.0.0\n…\n---\n## 1. Kapan dipakai / kapan TIDAK dipakai\n…"}
            className="mt-3 w-full resize-y rounded-2xl border border-[var(--border)] bg-[#0A1130] p-3 font-mono text-xs leading-relaxed text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={() => validateSkillText.mutate()}
            disabled={!skillText.trim() || validateSkillText.isPending}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-white/8 px-4 py-2 text-sm font-bold hover:bg-white/12 disabled:opacity-50"
          >
            <Icon name="check" size={15} />
            {validateSkillText.isPending ? "Memvalidasi…" : "Validasi SKILL.md"}
          </button>
          {validation && (
            <div
              role="status"
              className={`dw-rise mt-3 rounded-xl border px-4 py-3 text-sm ${
                validation.valid
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-200"
              }`}
            >
              {validation.valid ? (
                <p className="font-bold">
                  Lolos — SKILL.md memenuhi format baku (semua field frontmatter
                  dan 10 bagian wajib ada, dalam urutan yang benar).
                </p>
              ) : (
                <>
                  <p className="font-bold">
                    Ditolak — {validation.errors.length} masalah ditemukan:
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5">
                    {validation.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 border-t border-[var(--border-soft)] pt-4">
          <h3 className="text-sm font-bold">Katalog SKILL.md (G1)</h3>
          <p className="mt-1 text-[13px] text-[var(--dim)]">
            Daftar file skill yang tersimpan di prototipe. Klik nama skill
            untuk membaca isi SKILL.md lengkapnya.
          </p>
          <button
            onClick={() => loadCatalog.mutate()}
            disabled={loadCatalog.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/8 px-4 py-2 text-sm font-bold hover:bg-white/12 disabled:opacity-50"
          >
            <Icon name="grid" size={15} />
            {loadCatalog.isPending ? "Memuat…" : "Lihat Daftar Skill"}
          </button>
          {catalog && (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {catalog.map((s) => (
                <li key={s.name}>
                  <button
                    onClick={() => loadSkillDoc.mutate(s.name)}
                    className="w-full rounded-xl border border-[var(--border-soft)] bg-[#0A1130] px-3.5 py-2.5 text-left hover:border-[var(--accent)]"
                  >
                    <span className="font-mono text-[13px] font-bold text-slate-100">
                      {s.name}
                    </span>{" "}
                    <span className="text-xs text-[var(--dim)]">
                      v{s.version} · {s.family}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-[var(--dim)]">
                      {s.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {skillDoc && (
            <div className="dw-rise mt-3 rounded-2xl border border-[var(--border-soft)] bg-[#0A1130] p-4">
              <p className="font-mono text-sm font-bold">{skillDoc.name}</p>
              {skillDoc.error ? (
                <p className="mt-1 text-sm text-rose-300">{skillDoc.error}</p>
              ) : (
                <pre className="mt-2 max-h-[420px] overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">
                  {skillDoc.content}
                </pre>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Pipeline progress */}
      {(busy || (liveStages && liveStages.length > 0)) && (
        <section
          className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5"
          aria-live="polite"
        >
          <h2 className="flex items-center gap-2 text-[15px] font-bold">
            <span className="dw-live-dot h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
            Pipeline AI Dadiweb
          </h2>
          <ol className="mt-4 space-y-2">
            {STAGE_META.map((meta, idx) => {
              const done = workingStages.find((s) => s.stage === meta.key);
              const isCurrent =
                busy && !done && idx === workingStages.length && !sendChat.isPending;
              return (
                <li
                  key={meta.key}
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                    done
                      ? "border-emerald-500/25 bg-emerald-500/5"
                      : isCurrent
                        ? "border-[var(--accent)]/50 bg-[#2E6BFF]/8"
                        : "border-[var(--border-soft)] opacity-55"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                      done
                        ? "bg-emerald-500 text-white"
                        : isCurrent
                          ? "bg-[var(--accent)] text-white"
                          : "bg-white/10 text-[var(--dim)]"
                    }`}
                  >
                    {done ? <Icon name="check" size={14} /> : idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-bold">{meta.label}</span>
                      <span className="text-xs text-[var(--dim)]">
                        {done ? done.note : meta.desc}
                      </span>
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-xs font-bold text-[var(--dim)]">
                    {done ? `−${meta.cost}` : `${meta.cost}`} kredit
                  </span>
                </li>
              );
            })}
          </ol>

          {doneProjectId !== null && (
            <div className="dw-rise mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4">
              <p className="font-bold text-emerald-300">
                Website selesai dibuat! Total {state.generateCost} kredit terpakai.
              </p>
              {routeDone && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-emerald-100/80">
                  Skill yang dipakai (Router v1, SKILL.md {routeDone.versions[0]?.version ?? "1.0.0"}):{" "}
                  <span className="font-mono font-bold">{routeDone.label}</span> —
                  ditentukan oleh {winnerText(routeDone.winnerSource).toLowerCase()}.
                  Rincian per tahap tersimpan di proyek dan tampil di Editor pada
                  blok “Skill yang dipakai”.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => nav.go("project", doneProjectId)}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white"
                >
                  <Icon name="eye" size={15} /> Lihat Hasil &amp; Preview
                </button>
                <button
                  onClick={() => nav.go("deploy", doneProjectId)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/15"
                >
                  <Icon name="rocket" size={15} /> Deploy Sekarang
                </button>
              </div>
            </div>
          )}
          {busy && (
            <p className="mt-3 text-xs text-[var(--dim)]">
              Tahap yang gagal tidak memotong kredit. Kamu bisa menutup halaman
              ini — proyek tetap tersimpan di Proyek Saya.
            </p>
          )}
        </section>
      )}

      {/* Example prompts */}
      <section className="mt-6">
        <h2 className="text-[15px] font-bold">Contoh Prompt</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex.title}
              onClick={() => setPrompt(ex.text)}
              disabled={busy}
              className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--border)] hover:bg-[var(--surface-2)] disabled:opacity-60"
            >
              <span className="flex items-center gap-2.5">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                  style={{ background: ex.color }}
                >
                  <Icon name={ex.icon} size={16} />
                </span>
                <span className="text-sm font-bold">{ex.title}</span>
              </span>
              <span className="mt-2 line-clamp-2 block text-[13px] leading-relaxed text-[var(--dim)]">
                {ex.text}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
