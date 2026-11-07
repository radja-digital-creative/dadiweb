import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { AuthView, type AuthUser } from "./views-auth";
import {
Icon,
Logo,
NAV_MAIN,
fmtNum,
type View,
} from "./lib";
import { CreateView, DashboardView, type Nav } from "./views-main";
import { EditorView, ProjectsView, TemplatesView } from "./views-projects";
import { ProjectChatView } from "./views-project-chat";
import { CreditsView, DatabaseView, DeployView } from "./views-manage";
import {
AndroidView,
CommunityView,
HelpView,
IntegrationsView,
SettingsView,
} from "./views-more";
import { AdminPage } from "./views-admin";
import { PublicSiteView, detectPublicSlug } from "./views-public";

interface RouteState {
  view: View;
  projectId: number | null;
  filter?: string;
}

const BOTTOM_TABS: Array<{ view: View; label: string; icon: string }> = [
  { view: "dashboard", label: "Beranda", icon: "home" },
  { view: "projects", label: "Proyek", icon: "folder" },
  { view: "create", label: "Buat AI", icon: "spark" },
  { view: "templates", label: "Template", icon: "grid" },
];

// Menu halaman client. Entri Admin TIDAK ada di daftar dasar ini: tautan ke
// halaman admin hanya ditambahkan untuk akun admin (lihat menuItems di
// dalam App) — akun non-admin tidak melihat tautan admin apa pun.
const MENU_ITEMS: Array<{ view: View; label: string; icon: string }> = [
  ...NAV_MAIN,
  { view: "settings", label: "Pengaturan", icon: "gear" },
];

const ADMIN_MENU_ITEM: { view: View; label: string; icon: string } = {
  view: "admin",
  label: "Admin Panel",
  icon: "shield",
};

const TOKEN_KEY = "dadiweb-session-token";

export function App() {
  const queryClient = useQueryClient();
  // Halaman admin adalah halaman terpisah dalam aplikasi yang sama, di
  // route-nya sendiri (#/admin). Status halaman mengikuti hash URL agar
  // route admin bisa dibuka/ditandai langsung dan tombol kembali browser
  // bekerja; halaman client tidak memakai hash.
  const [page, setPage] = useState<"client" | "admin">(() =>
    typeof window !== "undefined" && window.location.hash.startsWith("#/admin")
      ? "admin"
      : "client",
  );
  useEffect(() => {
    const onHash = () =>
      setPage(window.location.hash.startsWith("#/admin") ? "admin" : "client");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const goAdminPage = () => {
    setPage("admin");
    if (!window.location.hash.startsWith("#/admin")) {
      window.location.hash = "/admin";
    }
    window.scrollTo({ top: 0 });
  };
  const backToClient = () => {
    setPage("client");
    if (window.location.hash.startsWith("#/admin")) {
      // Bersihkan hash tanpa menambah entri riwayat baru.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    window.scrollTo({ top: 0 });
  };
  const [route, setRoute] = useState<RouteState>({ view: "dashboard", projectId: null });
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Ctrl/Cmd+K focuses the global search, as the kbd hint in the topbar says.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [token, setToken] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const session = useQuery({
    queryKey: ["dadiweb-session", token],
    queryFn: () => api.authSession({ token: token ?? "" }),
    enabled: token !== null,
  });

  const authenticated = token !== null && session.data?.user != null;

  // Token stored but no longer valid (expired / revoked) → back to login.
  useEffect(() => {
    if (token !== null && session.data && !session.data.user) {
      try {
        window.localStorage.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
      setToken(null);
    }
  }, [token, session.data]);

  const state = useQuery({
    queryKey: ["dadiweb-state", token],
    queryFn: () => api.getState({ token: token ?? "" }),
    enabled: authenticated,
  });

  const onAuthenticated = (nextToken: string, _user: AuthUser) => {
    void _user;
    try {
      window.localStorage.setItem(TOKEN_KEY, nextToken);
    } catch {
      /* ignore */
    }
    // Drop any cached workspace snapshot from a previous account so the UI
    // only ever renders data belonging to the account that just signed in
    // (all data is isolated per user on the server).
    void queryClient.removeQueries({ queryKey: ["dadiweb-state"] });
    void queryClient.removeQueries({ queryKey: ["project-detail"] });
    setToken(nextToken);
    setRoute({ view: "dashboard", projectId: null });
  };

  const logout = () => {
    const current = token;
    setMenuOpen(false);
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
    setRoute({ view: "dashboard", projectId: null });
    if (current) {
      void api.authLogout({ token: current }).catch(() => undefined);
    }
    void queryClient.removeQueries({ queryKey: ["dadiweb-state"] });
    void queryClient.removeQueries({ queryKey: ["project-detail"] });
    void queryClient.invalidateQueries();
  };

  const nav: Nav = useMemo(
    () => ({
      go: (view: View, projectId?: number) => {
        setMenuOpen(false);
        if (view === "projects" && projectId === undefined) {
          setRoute({ view, projectId: null });
          return;
        }
        setRoute({ view, projectId: projectId ?? null });
        window.scrollTo({ top: 0 });
      },
    }),
    [],
  );

  const goDashboardPrompt = (text: string) => {
    setPendingPrompt(text);
    nav.go("create");
  };

  // G10 — situs publik didahulukan atas gerbang login: hostname
  // {slug}.dadiweb.id (atau ?site={slug} untuk pengujian prototipe)
  // menampilkan situs proyek itu sendiri, bukan aplikasi/login/editor.
  // Semua hook di atas sudah berjalan, jadi cabang return ini aman.
  const publicSlug = useMemo(() => detectPublicSlug(), []);
  if (publicSlug) {
    return <PublicSiteView slug={publicSlug} />;
  }

  if (token !== null && session.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <Logo size={52} />
          </div>
          <p className="text-lg font-extrabold tracking-tight">
            dadi<span className="text-[#2E6BFF]">web</span>
          </p>
          <p className="mt-1 text-sm text-[var(--dim)]">Memeriksa sesi masuk…</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <AuthView onAuthenticated={onAuthenticated} />;
  }

  if (state.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <Logo size={52} />
          </div>
          <p className="text-lg font-extrabold tracking-tight">
            dadi<span className="text-[#2E6BFF]">web</span>
          </p>
          <p className="mt-1 text-sm text-[var(--dim)]">Memuat workspace…</p>
        </div>
      </div>
    );
  }

  if (state.isError || !state.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
        <div className="max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
          <p className="font-bold">Workspace gagal dimuat</p>
          <p className="mt-2 text-sm text-[var(--dim)]">
            Terjadi masalah saat membaca data prototipe. Coba muat ulang.
          </p>
          <button
            onClick={() => void state.refetch()}
            className="mt-4 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white"
          >
            Muat Ulang
          </button>
        </div>
      </div>
    );
  }

  const data = state.data;

  // Tautan ke halaman admin hanya untuk akun admin.
  const menuItems = data.workspace.isAdmin
    ? [...MENU_ITEMS, ADMIN_MENU_ITEM]
    : MENU_ITEMS;

  // Halaman admin terpisah di route #/admin, dengan layout dan navigasi
  // sendiri; tidak ada panel admin yang tertanam di halaman client.
  // AdminPage sendiri menggerbang non-admin (penolakan akses, tanpa
  // me-mount panel admin apa pun).
  if (page === "admin") {
    return (
      <AdminPage
        state={data}
        token={token ?? ""}
        onBack={backToClient}
        onLogout={logout}
      />
    );
  }

  const activeNav: View = route.view === "editor" || route.view === "project" ? "projects" : route.view;

  const searchMatches = globalSearch.trim()
    ? [
        ...data.projects
          .filter((p) =>
            p.name.toLowerCase().includes(globalSearch.trim().toLowerCase()),
          )
          .map((p) => ({ kind: "Proyek" as const, id: p.id, label: p.name })),
        ...data.templates
          .filter((t) =>
            t.name.toLowerCase().includes(globalSearch.trim().toLowerCase()),
          )
          .map((t) => ({ kind: "Template" as const, id: -t.id, label: t.name })),
      ].slice(0, 6)
    : [];

  const sidebarLink = (item: { view: View; label: string; icon: string }) => {
    const active = activeNav === item.view;
    return (
      <button
        key={item.view}
        onClick={() => (item.view === "admin" ? goAdminPage() : nav.go(item.view))}
        aria-current={active ? "page" : undefined}
        className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
          active
            ? "bg-gradient-to-r from-[#2E6BFF] to-[#5B5BFF] text-white shadow-lg shadow-blue-950/60"
            : "text-[#A7B1CF] hover:bg-white/5 hover:text-white"
        }`}
      >
        <Icon name={item.icon} size={18} />
        {item.label}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto flex max-w-[1600px]">
        {/* Sidebar — desktop */}
        <aside className="sticky top-0 hidden h-screen w-[228px] shrink-0 flex-col border-r border-[var(--border-soft)] bg-[#080E29] px-3 pb-4 pt-5 lg:flex">
          <div className="flex items-center gap-2.5 px-2">
            <Logo size={36} />
            <div className="leading-tight">
              <p className="text-xl font-extrabold tracking-tight">
                dadi<span className="text-[#2E6BFF]">web</span>
              </p>
              <p className="text-[10px] font-medium text-[var(--dim)]">
                Website &amp; App Builder with AI
              </p>
            </div>
          </div>
          <nav className="mt-7 flex-1 space-y-1 overflow-y-auto" aria-label="Navigasi utama">
            {menuItems.map(sidebarLink)}
          </nav>
          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-3.5">
            <p className="flex items-center gap-1.5 text-[13px] font-bold">
              <Icon name="crown" size={15} className="text-amber-400" />
              {data.account.plan}
            </p>
            <p className="mt-1 text-xs text-[var(--dim)] tnum">
              {fmtNum(data.account.balance)} / {fmtNum(data.account.monthlyQuota)} kredit
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF]"
                style={{
                  width: `${Math.round((data.account.balance / Math.max(data.account.monthlyQuota, 1)) * 100)}%`,
                }}
              />
            </div>
            <button
              onClick={() => nav.go("credits")}
              className="mt-3 w-full rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] py-2 text-[13px] font-bold text-white transition hover:brightness-110"
            >
              Upgrade Plan
            </button>
            <button
              onClick={logout}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white/6 py-2 text-[13px] font-bold text-slate-200 transition hover:bg-white/10"
            >
              <Icon name="logout" size={15} /> Keluar
            </button>
          </div>
        </aside>

        {/* Main column */}
        <div className="min-w-0 flex-1">
          {/* Topbar */}
          <header className="sticky top-0 z-40 border-b border-[var(--border-soft)] bg-[#070D24]/92 pt-safe backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-2 lg:hidden">
                <Logo size={30} />
                <p className="text-lg font-extrabold tracking-tight">
                  dadi<span className="text-[#2E6BFF]">web</span>
                </p>
              </div>
              <div className="relative mx-auto hidden w-full max-w-xl md:block">
                <label className="relative block">
                  <span className="sr-only">Cari proyek, template, atau fitur</span>
                  <Icon
                    name="search"
                    size={16}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--dim)]"
                  />
                  <input
                    ref={searchRef}
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                    placeholder="Cari proyek, template, atau fitur…"
                    className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] py-2.5 pl-10 pr-14 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--dim)]">
                    Ctrl K
                  </kbd>
                </label>
                {searchMatches.length > 0 && (
                  <ul className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl">
                    {searchMatches.map((m) => (
                      <li key={`${m.kind}-${m.id}`}>
                        <button
                          onClick={() => {
                            setGlobalSearch("");
                            if (m.kind === "Proyek") nav.go("editor", m.id);
                            else nav.go("templates");
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/6"
                        >
                          <span className="rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] font-bold text-[var(--dim)]">
                            {m.kind}
                          </span>
                          <span className="font-semibold">{m.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2 md:ml-0">
                <span className="hidden items-center gap-1.5 rounded-xl bg-[#141B3F] px-3 py-2 text-[13px] font-bold tnum sm:inline-flex">
                  <Icon name="bolt" size={15} className="text-amber-400" />
                  {fmtNum(data.account.balance)} kredit
                </span>
                <button
                  onClick={() => nav.go("create")}
                  className="hidden items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-3.5 py-2 text-[13px] font-bold text-white transition hover:brightness-110 sm:inline-flex"
                >
                  <Icon name="plus" size={15} /> Buat Baru
                </button>
                <div className="relative">
                  <button
                    onClick={() => setNotifOpen((v) => !v)}
                    aria-label="Notifikasi aktivitas"
                    aria-expanded={notifOpen}
                    className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface)] ring-1 ring-[var(--border-soft)] hover:bg-[var(--surface-2)]"
                  >
                    <Icon name="bell" size={17} />
                    {data.ledger.length > 0 && (
                      <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" />
                    )}
                  </button>
                  {notifOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-[320px] max-w-[86vw] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl">
                      <div className="flex items-center justify-between px-4 py-3">
                        <p className="text-sm font-bold">Notifikasi</p>
                        <button
                          onClick={() => setNotifOpen(false)}
                          aria-label="Tutup notifikasi"
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8"
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                      {data.ledger.length === 0 ? (
                        <p className="px-4 pb-4 text-sm text-[var(--dim)]">
                          Belum ada aktivitas. Notifikasi generate, deploy, build
                          Android, dan top up akan muncul di sini.
                        </p>
                      ) : (
                        <ul className="max-h-[320px] divide-y divide-[var(--border-soft)] overflow-y-auto">
                          {data.ledger.slice(0, 8).map((l) => (
                            <li key={l.id} className="px-4 py-2.5 text-sm">
                              <span className="block truncate font-semibold">{l.label}</span>
                              <span className="text-xs text-[var(--dim)]">
                                {l.amount > 0 ? "+" : "−"}
                                {fmtNum(Math.abs(l.amount))} kredit · saldo{" "}
                                {fmtNum(l.balanceAfter)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        onClick={() => {
                          setNotifOpen(false);
                          nav.go("credits");
                        }}
                        className="w-full border-t border-[var(--border-soft)] px-4 py-2.5 text-center text-[13px] font-bold text-[#6EA8FF] hover:bg-white/5"
                      >
                        Lihat Kredit &amp; Langganan
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => nav.go("settings")}
                  className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-1 ring-1 ring-transparent transition hover:ring-[var(--border-soft)] sm:pr-2"
                  aria-label="Buka pengaturan profil"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#2E6BFF] to-[#7C4DFF] text-[13px] font-extrabold text-white">
                    {data.workspace.displayName.charAt(0)}
                  </span>
                  <span className="hidden text-left leading-tight xl:block">
                    <span className="block text-[13px] font-bold">
                      {data.workspace.displayName}
                    </span>
                    <span className="block text-[11px] text-[var(--dim)]">
                      {data.workspace.plan}
                    </span>
                  </span>
                </button>
                <button
                  onClick={logout}
                  aria-label="Keluar dari akun"
                  title="Keluar"
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface)] ring-1 ring-[var(--border-soft)] hover:bg-[var(--surface-2)]"
                >
                  <Icon name="logout" size={17} />
                </button>
              </div>
            </div>
          </header>

          <main className="px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
            {/* G5-C — pesan maintenance platform tampil untuk pengguna
                non-admin; panel Admin sendiri tidak diblokir olehnya. */}
            {data.platform?.maintenanceEnabled &&
              data.platform.maintenanceMessage &&
              data.workspace.email !== "budi@email.com" && (
                <div
                  role="status"
                  className="mb-5 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
                >
                  <strong className="font-bold">Pengumuman pemeliharaan:</strong>{" "}
                  {data.platform.maintenanceMessage}
                </div>
              )}
            {route.view === "dashboard" && (
              <DashboardView state={data} nav={nav} token={token ?? ""} onPrompt={goDashboardPrompt} />
            )}
            {route.view === "create" && (
              <CreateView
                state={data}
                nav={nav}
                token={token ?? ""}
                initialPrompt={pendingPrompt}
                consumeInitialPrompt={() => setPendingPrompt("")}
              />
            )}
            {route.view === "projects" && (
              <ProjectsView state={data} nav={nav} token={token ?? ""} initialFilter={route.filter} />
            )}
            {route.view === "templates" && <TemplatesView state={data} nav={nav} token={token ?? ""} />}
            {route.view === "database" && (
              <DatabaseView state={data} nav={nav} token={token ?? ""} focusProjectId={route.projectId} />
            )}
            {route.view === "deploy" && (
              <DeployView state={data} token={token ?? ""} focusProjectId={route.projectId} />
            )}
            {route.view === "android" && <AndroidView state={data} nav={nav} token={token ?? ""} />}
            {route.view === "integrations" && <IntegrationsView state={data} token={token ?? ""} />}
            {route.view === "credits" && <CreditsView state={data} token={token ?? ""} />}
            {route.view === "community" && <CommunityView token={token ?? ""} />}
            {route.view === "help" && <HelpView />}
            {route.view === "settings" && <SettingsView state={data} token={token ?? ""} onLogout={logout} />}
{/* Panel admin tidak lagi dirender di halaman client — halaman
                admin terpisah di #/admin (lihat AdminPage di atas). */}
            {route.view === "editor" && route.projectId !== null && (
              <EditorView projectId={route.projectId} nav={nav} token={token ?? ""} />
            )}
            {route.view === "project" && route.projectId !== null && (
              <ProjectChatView projectId={route.projectId} nav={nav} token={token ?? ""} />
            )}
          </main>
        </div>
      </div>

      {/* Mobile menu drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu navigasi">
          <button
            aria-label="Tutup menu"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMenuOpen(false)}
          />
          <div className="dw-rise absolute inset-y-0 left-0 flex w-[280px] flex-col bg-[#080E29] px-3 pb-5 pt-safe">
            <div className="flex items-center gap-2.5 px-2 py-3">
              <Logo size={32} />
              <p className="text-lg font-extrabold tracking-tight">
                dadi<span className="text-[#2E6BFF]">web</span>
              </p>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Tutup menu navigasi"
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg bg-white/8"
              >
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-[var(--surface)] p-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#2E6BFF] to-[#7C4DFF] font-extrabold text-white">
                {data.workspace.displayName.charAt(0)}
              </span>
              <div className="leading-tight">
                <p className="text-sm font-bold">{data.workspace.displayName}</p>
                <p className="text-xs text-[var(--dim)]">{data.workspace.plan}</p>
              </div>
            </div>
            <nav className="mt-4 flex-1 space-y-1 overflow-y-auto" aria-label="Menu lengkap">
              {menuItems.map(sidebarLink)}
            </nav>
            <p className="px-2 pt-3 text-xs text-[var(--dim)] tnum">
              Sisa kredit: {fmtNum(data.account.balance)} dari {fmtNum(data.account.monthlyQuota)}
            </p>
            <button
              onClick={logout}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white/6 py-2.5 text-sm font-bold text-slate-200 hover:bg-white/10"
            >
              <Icon name="logout" size={16} /> Keluar dari Akun
            </button>
          </div>
        </div>
      )}

      {/* Bottom tab bar — mobile */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-soft)] bg-[#080E29]/97 pb-safe backdrop-blur lg:hidden"
        aria-label="Navigasi bawah"
      >
        <div className="grid grid-cols-5">
          {BOTTOM_TABS.slice(0, 2).map((t) => (
            <BottomTab
              key={t.view}
              active={activeNav === t.view}
              label={t.label}
              icon={t.icon}
              onClick={() => nav.go(t.view)}
            />
          ))}
          <div className="flex items-start justify-center">
            <button
              onClick={() => nav.go("create")}
              aria-label="Buat dengan AI"
              className="mt-[-14px] flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#2E6BFF] to-[#7C4DFF] text-white shadow-xl shadow-indigo-950/70 ring-4 ring-[#070D24]"
            >
              <Icon name="plus" size={22} />
            </button>
          </div>
          {BOTTOM_TABS.slice(3).map((t) => (
            <BottomTab
              key={t.view}
              active={activeNav === t.view}
              label={t.label}
              icon={t.icon}
              onClick={() => nav.go(t.view)}
            />
          ))}
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Buka menu lengkap"
            className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-[var(--dim)]"
          >
            <Icon name="dots" size={20} />
            Menu
          </button>
        </div>
      </nav>
    </div>
  );
}

function BottomTab({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${
        active ? "text-[#6EA8FF]" : "text-[var(--dim)]"
      }`}
    >
      <Icon name={icon} size={20} />
      {label}
    </button>
  );
}
