import { useState } from "react";
import { Icon, Logo, type State } from "./lib";
import {
  AdminCompletePanel,
  AdminSummary,
  AiProviderPanel,
  CloudflarePanel,
  FalVideoPanel,
  GitHubOAuthPanel,
  GoogleOAuthPanel,
  SkillCatalogPanel,
  type AdminCompleteSection,
} from "./views-more";

// ---------------------------------------------------------------------------
// Halaman Admin — halaman terpisah di route #/admin dalam aplikasi yang
// sama. Layout dan navigasinya sendiri (12 modul), terpisah penuh dari
// halaman client: tidak ada panel admin yang tertanam di halaman client,
// dan halaman ini tidak me-mount panel/modul admin apa pun untuk akun
// non-admin (penolakan akses ditampilkan, data admin tidak dimuat).
// Gerbang sesungguhnya tetap di server: semua aksi admin menolak
// non-admin seperti sebelumnya.
// ---------------------------------------------------------------------------

export type AdminModuleId =
  | "ringkasan"
  | "pengguna"
  | "proyek"
  | "deployment"
  | "skill"
  | "ai"
  | "kredit"
  | "invoice"
  | "integrasi"
  | "komunitas"
  | "platform"
  | "audit";

const MODULES: Array<{ id: AdminModuleId; label: string; icon: string }> = [
  { id: "ringkasan", label: "Ringkasan", icon: "chart" },
  { id: "pengguna", label: "Pengguna", icon: "users" },
  { id: "proyek", label: "Proyek", icon: "folder" },
  { id: "deployment", label: "Deployment", icon: "rocket" },
  { id: "skill", label: "Katalog Skill", icon: "book" },
  { id: "ai", label: "Model AI & Provider", icon: "spark" },
  { id: "kredit", label: "Kredit & Langganan", icon: "card" },
  { id: "invoice", label: "Invoice & Pembayaran", icon: "table" },
  { id: "integrasi", label: "Integrasi", icon: "link" },
  { id: "komunitas", label: "Komunitas & Moderasi", icon: "chat" },
  { id: "platform", label: "Pengaturan Platform", icon: "gear" },
  { id: "audit", label: "Log Audit Admin", icon: "archive" },
];

// Modul yang isinya berasal dari panel admin lengkap (satu bagian per modul).
const COMPLETE_SECTIONS: Partial<Record<AdminModuleId, AdminCompleteSection>> = {
  pengguna: "pengguna",
  proyek: "proyek",
  deployment: "deployment",
  kredit: "kredit",
  invoice: "invoice",
  integrasi: "integrasi",
  komunitas: "komunitas",
  platform: "platform",
  audit: "audit",
};

export function AdminPage({
  state,
  token,
  onBack,
  onLogout,
}: {
  state: State;
  token: string;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [module, setModule] = useState<AdminModuleId>("ringkasan");

  // Penggerbangan: akun non-admin tidak melihat konten admin apa pun dan
  // tidak ada panel admin yang di-mount (jadi tidak ada data admin yang
  // dimuat) — hanya penolakan akses dan jalan kembali ke halaman client.
  if (!state.workspace.isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4 text-[var(--text)]">
        <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400">
            <Icon name="shield" size={22} />
          </span>
          <h1 className="mt-4 text-xl font-extrabold tracking-tight">Akses Ditolak</h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
            Halaman admin hanya bisa dibuka akun admin platform. Akunmu (
            {state.workspace.email}) bukan akun admin, jadi tidak ada konten
            admin yang dimuat di sini.
          </p>
          <button
            onClick={onBack}
            className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
          >
            Kembali ke Halaman Client
          </button>
        </div>
      </div>
    );
  }

  const completeSection = COMPLETE_SECTIONS[module];

  const moduleButton = (m: (typeof MODULES)[number]) => {
    const active = module === m.id;
    return (
      <button
        key={m.id}
        onClick={() => setModule(m.id)}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
          active
            ? "bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-lg shadow-rose-950/60"
            : "text-[#C9A7B1] hover:bg-white/5 hover:text-white"
        }`}
      >
        <Icon name={m.icon} size={18} />
        {m.label}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto flex max-w-[1600px]">
        {/* Sidebar admin — desktop */}
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-rose-950/60 bg-[#170B1E] px-3 pb-4 pt-5 lg:flex">
          <div className="flex items-center gap-2.5 px-2">
            <Logo size={36} />
            <div className="leading-tight">
              <p className="text-xl font-extrabold tracking-tight">
                dadi<span className="text-rose-400">web</span>
              </p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-rose-300/80">
                Halaman Admin
              </p>
            </div>
          </div>
          <nav className="mt-7 flex-1 space-y-1 overflow-y-auto" aria-label="Modul admin">
            {MODULES.map(moduleButton)}
          </nav>
          <div className="space-y-2 border-t border-white/8 pt-4">
            <button
              onClick={onBack}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] py-2.5 text-[13px] font-bold text-white transition hover:brightness-110"
            >
              <Icon name="back" size={15} /> Kembali ke Halaman Client
            </button>
            <button
              onClick={onLogout}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/6 py-2 text-[13px] font-bold text-slate-200 transition hover:bg-white/10"
            >
              <Icon name="logout" size={15} /> Keluar
            </button>
          </div>
        </aside>

        {/* Kolom utama admin */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 border-b border-rose-950/60 bg-[#170B1E]/95 pt-safe backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              <button
                onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 text-[13px] font-bold text-slate-100 transition hover:bg-white/12"
              >
                <Icon name="back" size={15} /> Halaman Client
              </button>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-300">
                <Icon name="shield" size={13} /> Admin
              </span>
              <div className="ml-auto flex items-center gap-2">
                <span className="hidden text-right leading-tight sm:block">
                  <span className="block text-[13px] font-bold">{state.workspace.displayName}</span>
                  <span className="block text-[11px] text-[var(--dim)]">{state.workspace.email}</span>
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-700 text-[13px] font-extrabold text-white">
                  {state.workspace.displayName.charAt(0)}
                </span>
                <button
                  onClick={onLogout}
                  aria-label="Keluar dari akun"
                  title="Keluar"
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface)] ring-1 ring-[var(--border-soft)] hover:bg-[var(--surface-2)] lg:hidden"
                >
                  <Icon name="logout" size={17} />
                </button>
              </div>
            </div>
            {/* Navigasi modul — mobile/tablet (membungkus, tanpa scroll samping) */}
            <nav
              className="flex flex-wrap gap-1.5 px-4 pb-3 sm:px-6 lg:hidden"
              aria-label="Modul admin"
            >
              {MODULES.map((m) => {
                const active = module === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setModule(m.id)}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      active
                        ? "bg-gradient-to-r from-rose-500 to-rose-600 text-white"
                        : "bg-white/6 text-[#C9A7B1] hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon name={m.icon} size={13} />
                    {m.label}
                  </button>
                );
              })}
            </nav>
          </header>

          <main className="px-4 pb-16 pt-5 sm:px-6">
            {module === "ringkasan" && <AdminSummary state={state} token={token} />}
            {module !== "ringkasan" && (
              <div>
                <span className="inline-block rounded-full bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-400">
                  Khusus Admin
                </span>
                <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
                  {MODULES.find((m) => m.id === module)?.label}
                </h1>
                {module === "skill" && <SkillCatalogPanel token={token} />}
                {module === "ai" && <AiProviderPanel token={token} />}
                {module === "platform" && <GoogleOAuthPanel token={token} />}
                {module === "platform" && <GitHubOAuthPanel token={token} />}
                {module === "platform" && <CloudflarePanel token={token} />}
                {module === "platform" && <FalVideoPanel token={token} />}
                {completeSection && (
                  <AdminCompletePanel token={token} section={completeSection} />
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
