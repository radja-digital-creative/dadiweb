import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import {
FAQ_ITEMS,
Icon,
INTEGRATIONS,
downloadText,
fmtNum,
timeAgo,
type State,
} from "./lib";
import type { Nav } from "./views-main";
import { SimulatedInbox } from "./views-auth";

// ---------------------------------------------------------------------------
// Phase panel — honest placeholder for roadmap Phase 2/3 features
// ---------------------------------------------------------------------------

export function PhasePanel({
  phase,
  title,
  desc,
  bullets,
  children,
}: {
  phase: string;
  title: string;
  desc: string;
  bullets: string[];
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <span className="inline-block rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-400">
        {phase} — Sesuai Roadmap
      </span>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--dim)]">{desc}</p>
      <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <h2 className="text-[15px] font-bold">Yang akan dibangun di fase ini</h2>
        <ul className="mt-3 space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm text-slate-200">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2E6BFF]/15 text-[#6EA8FF]">
                <Icon name="check" size={11} />
              </span>
              {b}
            </li>
          ))}
        </ul>
        {children}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aplikasi Android (Fase 3)
// ---------------------------------------------------------------------------

export function AndroidView({ state, nav, token }: { state: State; nav: Nav; token: string }) {
  const queryClient = useQueryClient();
  const candidates = state.projects.filter((p) => p.status !== "archived");
  const [projectId, setProjectId] = useState<number | null>(candidates[0]?.id ?? null);
  const project = candidates.find((p) => p.id === projectId) ?? candidates[0] ?? null;
  const [appName, setAppName] = useState("");
  const [packageId, setPackageId] = useState("");
  const [buildType, setBuildType] = useState<"apk" | "aab">("apk");
  const [iconColor, setIconColor] = useState("#2E6BFF");
  const [splashText, setSplashText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const builds = state.androidBuilds.filter((b) => !project || b.projectId === project.id);

  const build = useMutation({
    mutationFn: () =>
      api.createAndroidBuild({
        token,
        projectId: project?.id ?? 0,
        appName: (appName || project?.name || "").trim(),
        packageId: (packageId || `com.dadiweb.${project?.slug.replace(/-/g, "") ?? "app"}`).trim(),
        buildType,
        iconColor,
        splashText: splashText.trim(),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      if (res.ok) {
        setError(null);
        setNotice(
          `Build ${buildType.toUpperCase()} selesai: ${(appName || project?.name) ?? "Aplikasi"} v${res.versionName} (kode versi ${res.versionCode}) siap diunduh sebagai paket build Capacitor — ${state.androidBuildCost} kredit terpakai.`,
        );
      } else {
        setNotice(null);
        setError(res.error ?? "Build gagal.");
      }
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Build gagal."),
  });

  const downloadManifest = (b: State["androidBuilds"][number]) => {
    const manifest = {
      appName: b.appName,
      packageId: b.packageId,
      versionName: b.versionName,
      versionCode: b.versionCode,
      buildType: b.buildType,
      iconColor: b.iconColor,
      splashText: b.splashText,
      webUrl: `https://${state.projects.find((p) => p.id === b.projectId)?.slug ?? "proyek"}.dadiweb.id`,
      capacitor: {
        appId: b.packageId,
        appName: b.appName,
        webDir: "dist",
        server: { androidScheme: "https" },
      },
      builtWith: "Dadiweb Android Builder (Capacitor)",
      builtAt: b.createdAt,
    };
    downloadText(
      `${b.packageId}-v${b.versionName}-${b.buildType}.json`,
      JSON.stringify(manifest, null, 2),
      "application/json",
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Aplikasi Android</h1>
      <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--dim)]">
        Ubah proyek web kamu menjadi aplikasi Android dengan Capacitor: atur
        nama, Package ID, warna ikon, dan teks splash screen, lalu build
        APK/AAB. Setiap build menaikkan versi otomatis dan memakai{" "}
        {state.androidBuildCost} kredit.
      </p>

      {candidates.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-[var(--border)] p-10 text-center">
          <p className="font-bold">Belum ada proyek untuk dikonversi</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--dim)]">
            Buat website pertamamu dulu — proyek web apa pun bisa langsung
            dikonversi menjadi aplikasi Android dari halaman ini.
          </p>
          <button
            onClick={() => nav.go("create")}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white"
          >
            <Icon name="spark" size={15} /> Buat Website dengan AI
          </button>
        </div>
      ) : (
        <>
          <form
            className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              setNotice(null);
              setError(null);
              build.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Proyek web</span>
                <select
                  aria-label="Pilih proyek untuk build Android"
                  value={project?.id ?? ""}
                  onChange={(e) => {
                    setProjectId(Number(e.target.value));
                    setAppName("");
                    setPackageId("");
                  }}
                  className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm font-semibold text-white focus:border-[var(--accent)] focus:outline-none"
                >
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.slug}.dadiweb.id
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Nama aplikasi</span>
                <input
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder={project?.name ?? "Nama aplikasi"}
                  maxLength={50}
                  className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Package ID</span>
                <input
                  value={packageId}
                  onChange={(e) => setPackageId(e.target.value)}
                  placeholder={project ? `com.dadiweb.${project.slug.replace(/-/g, "")}` : "com.tokosaya.app"}
                  maxLength={80}
                  className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 font-mono text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Teks splash screen</span>
                <input
                  value={splashText}
                  onChange={(e) => setSplashText(e.target.value)}
                  placeholder="Selamat datang!"
                  maxLength={80}
                  className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
              <div className="flex items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Warna ikon</span>
                  <input
                    type="color"
                    value={iconColor}
                    onChange={(e) => setIconColor(e.target.value)}
                    aria-label="Warna ikon aplikasi"
                    className="h-[42px] w-16 cursor-pointer rounded-xl border border-[var(--border)] bg-[#0A1130] p-1"
                  />
                </label>
                <div className="flex rounded-xl bg-[#0A1130] p-1" role="group" aria-label="Jenis build">
                  {(["apk", "aab"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setBuildType(t)}
                      aria-pressed={buildType === t}
                      className={`rounded-lg px-4 py-2 text-sm font-bold uppercase ${buildType === t ? "bg-[var(--accent)] text-white" : "text-[var(--dim)]"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Splash preview */}
            <div className="mt-4 flex items-center gap-4 rounded-2xl bg-[#0A1130] p-4">
              <span
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] text-xl font-extrabold text-white shadow-lg"
                style={{ background: iconColor }}
              >
                {(appName || project?.name || "A").charAt(0)}
              </span>
              <div className="min-w-0">
                <p className="truncate font-bold">{appName || project?.name || "Aplikasi"}</p>
                <p className="truncate font-mono text-xs text-[var(--dim)]">
                  {packageId || (project ? `com.dadiweb.${project.slug.replace(/-/g, "")}` : "")}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--dim)]">
                  Splash: “{splashText || "Selamat datang!"}” · Format {buildType.toUpperCase()}
                  {buildType === "aab" ? " (untuk Google Play)" : " (instal langsung)"}
                </p>
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
                {error}{" "}
                {error.includes("tidak cukup") && (
                  <button type="button" onClick={() => nav.go("credits")} className="font-bold underline underline-offset-2">
                    Top up kredit
                  </button>
                )}
              </p>
            )}
            {notice && (
              <p role="status" className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
                {notice}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={build.isPending || !project}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-5 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
              >
                <Icon name="phone" size={15} />
                {build.isPending ? "Sedang Build…" : `Build ${buildType.toUpperCase()} (${state.androidBuildCost} kredit)`}
              </button>
              <span className="text-xs text-[var(--dim)]">
                Saldo: <strong className="text-white tnum">{fmtNum(state.account.balance)}</strong> kredit
              </span>
            </div>
            <ol className="mt-4 grid gap-2 text-[13px] text-[var(--dim)] sm:grid-cols-5">
              {["Konversi Capacitor", "Splash Screen", "Ikon & Nama", "Build APK/AAB", "Siap Play Store"].map((s, i) => (
                <li key={s} className="flex items-center gap-1.5">
                  <Icon name="check" size={13} className="shrink-0 text-emerald-400" /> {i + 1}. {s}
                </li>
              ))}
            </ol>
          </form>

          <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
            <h2 className="text-[15px] font-bold">Riwayat Build — {project?.name}</h2>
            {builds.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--dim)]">
                Belum ada build untuk proyek ini. Build pertamamu akan menjadi versi 1.0.0.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--border-soft)]">
                {builds.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-extrabold text-white"
                      style={{ background: b.iconColor }}
                    >
                      {b.appName.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">
                        {b.appName} · v{b.versionName} ({b.buildType.toUpperCase()})
                      </span>
                      <span className="block truncate font-mono text-xs text-[var(--dim)]">
                        {b.packageId} · kode versi {b.versionCode} · {timeAgo(b.createdAt)}
                      </span>
                    </span>
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                      {b.status === "ready" ? "Siap" : b.status}
                    </span>
                    <button
                      onClick={() => downloadManifest(b)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12"
                    >
                      <Icon name="download" size={13} /> Paket Build
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--dim)]">
              Paket build berisi manifest Capacitor lengkap (appId, nama, URL web,
              versi) yang dipakai pipeline rilis Dadiweb untuk menghasilkan biner
              APK/AAB dan mengunggahnya ke Google Play Console.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integrasi API (Fase 3, toggles already persist as preferences)
// ---------------------------------------------------------------------------

export function IntegrationsView({ state, token }: { state: State; token: string }) {
  const queryClient = useQueryClient();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { apiKey: string; webhookUrl: string }>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (args: { key: string; enabled: boolean; apiKey: string; webhookUrl: string }) =>
      api.saveIntegrationConfig({ token, ...args }),
    onSuccess: (_res, args) => {
      setSavedKey(args.key);
      setForms((f) => ({ ...f, [args.key]: { apiKey: "", webhookUrl: args.webhookUrl } }));
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
    },
  });

  const statusLabel = (status: string, enabled: boolean) => {
    if (!enabled) return { text: "Nonaktif", cls: "bg-white/8 text-[var(--dim)]" };
    if (status === "configured") return { text: "Terkonfigurasi", cls: "bg-emerald-500/15 text-emerald-400" };
    return { text: "Aktif — kunci belum disimpan", cls: "bg-amber-500/15 text-amber-400" };
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Integrasi API</h1>
      <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--dim)]">
        Hubungkan layanan pihak ketiga ke aplikasi yang kamu buat. Simpan kunci
        API dan URL webhook per layanan — konfigurasi ini dipakai aplikasi
        hasil generate-mu. Demi keamanan, kunci utuh tidak pernah disimpan:
        server hanya menyimpan 4 karakter terakhirnya sebagai petunjuk.
      </p>
      <ul className="mt-5 space-y-3">
        {INTEGRATIONS.map((item) => {
          const current = state.integrations.find((i) => i.key === item.key);
          const enabled = current?.enabled ?? false;
          const badge = statusLabel(current?.status ?? "inactive", enabled);
          const form = forms[item.key] ?? { apiKey: "", webhookUrl: current?.webhookUrl ?? "" };
          const isOpen = openKey === item.key;
          return (
            <li
              key={item.key}
              className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-center gap-4">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold text-white"
                  style={{ background: item.color }}
                >
                  {item.letter}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold sm:text-[15px]">
                    {item.name}
                  </span>
                  <span className="block text-[13px] text-[var(--dim)]">
                    {item.desc}
                    {current?.hasApiKey && (
                      <> · Kunci tersimpan {current.apiKeyHint}</>
                    )}
                  </span>
                </span>
                <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold sm:block ${badge.cls}`}>
                  {badge.text}
                </span>
                <button
                  onClick={() => setOpenKey(isOpen ? null : item.key)}
                  aria-expanded={isOpen}
                  className="shrink-0 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12"
                >
                  {isOpen ? "Tutup" : "Konfigurasi"}
                </button>
                <button
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? "Nonaktifkan" : "Aktifkan"} integrasi ${item.name}`}
                  onClick={() =>
                    save.mutate({
                      key: item.key,
                      enabled: !enabled,
                      apiKey: "",
                      webhookUrl: current?.webhookUrl ?? "",
                    })
                  }
                  disabled={save.isPending}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                    enabled ? "bg-[var(--accent)]" : "bg-white/15"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      enabled ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>

              {isOpen && (
                <form
                  className="dw-rise mt-4 grid gap-3 border-t border-[var(--border-soft)] pt-4 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate({
                      key: item.key,
                      enabled: true,
                      apiKey: form.apiKey,
                      webhookUrl: form.webhookUrl,
                    });
                  }}
                >
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">{item.keyLabel}</span>
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={(e) =>
                        setForms({ ...forms, [item.key]: { ...form, apiKey: e.target.value } })
                      }
                      placeholder={current?.hasApiKey ? `Tersimpan ${current.apiKeyHint} — isi untuk mengganti` : "Tempel kunci API kamu"}
                      autoComplete="off"
                      className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">URL Webhook (opsional)</span>
                    <input
                      type="url"
                      value={form.webhookUrl}
                      onChange={(e) =>
                        setForms({ ...forms, [item.key]: { ...form, webhookUrl: e.target.value } })
                      }
                      placeholder="https://aplikasikamu.com/webhook"
                      className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </label>
                  <div className="flex items-center gap-3 sm:col-span-2">
                    <button
                      type="submit"
                      disabled={save.isPending}
                      className="rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
                    >
                      {save.isPending ? "Menyimpan…" : "Simpan & Aktifkan"}
                    </button>
                    {savedKey === item.key && !save.isPending && (
                      <span role="status" className="text-sm text-emerald-300">Konfigurasi tersimpan.</span>
                    )}
                    {save.isError && savedKey === null && (
                      <span role="alert" className="text-sm text-rose-300">Gagal menyimpan konfigurasi.</span>
                    )}
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komunitas (Fase 3)
// ---------------------------------------------------------------------------

export function CommunityView({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("Semua");
  const tabs = ["Semua", "Diskusi", "Inspirasi", "Tutorial", "Pengumuman"];
  const [composer, setComposer] = useState({ title: "", body: "", tag: "Diskusi" as "Diskusi" | "Inspirasi" | "Tutorial" | "Pengumuman" });
  const [showComposer, setShowComposer] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [openComments, setOpenComments] = useState<Record<number, boolean>>({});

  const community = useQuery({
    queryKey: ["community", token],
    queryFn: () => api.getCommunity({ token }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["community"] });

  const createPost = useMutation({
    mutationFn: () => api.createCommunityPost({ token, ...composer, title: composer.title.trim(), body: composer.body.trim() }),
    onSuccess: () => {
      setComposer({ title: "", body: "", tag: "Diskusi" });
      setShowComposer(false);
      setTab("Semua");
      invalidate();
    },
  });
  const like = useMutation({
    mutationFn: (postId: number) => api.toggleCommunityLike({ token, postId }),
    onSuccess: invalidate,
  });
  const comment = useMutation({
    mutationFn: (postId: number) =>
      api.addCommunityComment({ token, postId, body: (commentDrafts[postId] ?? "").trim() }),
    onSuccess: (_res, postId) => {
      setCommentDrafts((d) => ({ ...d, [postId]: "" }));
      invalidate();
    },
  });

  const allPosts = community.data?.posts ?? [];
  const posts = tab === "Semua" ? allPosts : allPosts.filter((p) => p.tag === tab);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Komunitas</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--dim)]">
            Tempat pengguna Dadiweb berbagi prompt, template, dan tutorial.
            Buat postingan, beri suka, dan berkomentar — semuanya tersimpan
            dan terlihat oleh seluruh pengguna.
          </p>
        </div>
        <button
          onClick={() => setShowComposer((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2.5 text-sm font-bold text-white hover:brightness-110"
        >
          <Icon name="plus" size={15} /> Buat Postingan
        </button>
      </div>

      {showComposer && (
        <form
          className="dw-rise mt-5 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            createPost.mutate();
          }}
        >
          <h2 className="text-[15px] font-bold">Postingan Baru</h2>
          <div className="mt-3 grid gap-3">
            <input
              value={composer.title}
              onChange={(e) => setComposer({ ...composer, title: e.target.value })}
              required
              minLength={4}
              maxLength={120}
              placeholder="Judul postingan"
              aria-label="Judul postingan"
              className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3.5 py-2.5 text-sm font-semibold text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
            />
            <textarea
              value={composer.body}
              onChange={(e) => setComposer({ ...composer, body: e.target.value })}
              required
              maxLength={2000}
              rows={3}
              placeholder="Ceritakan prompt, pengalaman, atau tutorialmu…"
              aria-label="Isi postingan"
              className="w-full resize-none rounded-xl border border-[var(--border)] bg-[#0A1130] px-3.5 py-2.5 text-sm leading-relaxed text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-[var(--dim)]">
                Kategori
                <select
                  aria-label="Kategori postingan"
                  value={composer.tag}
                  onChange={(e) => setComposer({ ...composer, tag: e.target.value as typeof composer.tag })}
                  className="rounded-lg border border-[var(--border)] bg-[#0A1130] px-2.5 py-2 text-sm font-semibold text-white focus:outline-none"
                >
                  <option>Diskusi</option>
                  <option>Inspirasi</option>
                  <option>Tutorial</option>
                  <option>Pengumuman</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={createPost.isPending}
                className="ml-auto rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
              >
                {createPost.isPending ? "Mengirim…" : "Kirim Postingan"}
              </button>
            </div>
            {createPost.isError && (
              <p role="alert" className="text-sm text-rose-300">
                Gagal mengirim postingan — judul minimal 4 karakter dan isi tidak boleh kosong.
              </p>
            )}
          </div>
        </form>
      )}

      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Kategori komunitas">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
              tab === t
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] text-[var(--dim)] ring-1 ring-[var(--border-soft)] hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {community.isPending ? (
        <p className="py-14 text-center text-sm text-[var(--dim)]">Memuat komunitas…</p>
      ) : posts.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="font-bold">Belum ada postingan di kategori ini</p>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Jadilah yang pertama berbagi di kategori {tab}.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {posts.map((post) => (
            <li
              key={post.id}
              className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2E6BFF] to-[#7C4DFF] text-sm font-extrabold text-white">
                  {post.authorName.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-snug">{post.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--dim)]">
                    oleh {post.authorName}
                    {post.mine && " (kamu)"} · {timeAgo(post.createdAt)} ·{" "}
                    <span className="font-semibold text-[#6EA8FF]">{post.tag}</span>
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{post.body}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-2 pl-13">
                <button
                  onClick={() => like.mutate(post.id)}
                  disabled={like.isPending}
                  aria-pressed={post.likedByMe}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                    post.likedByMe
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-white/6 text-[var(--dim)] hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon name="bolt" size={13} /> {post.likeCount} suka
                </button>
                <button
                  onClick={() => setOpenComments({ ...openComments, [post.id]: !(openComments[post.id] ?? false) })}
                  aria-expanded={openComments[post.id] ?? false}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-1.5 text-xs font-bold text-[var(--dim)] hover:bg-white/10 hover:text-white"
                >
                  <Icon name="chat" size={13} /> {post.comments.length} komentar
                </button>
              </div>

              {(openComments[post.id] ?? false) && (
                <div className="dw-rise mt-3 border-t border-[var(--border-soft)] pt-3 pl-13">
                  {post.comments.length > 0 && (
                    <ul className="space-y-2.5">
                      {post.comments.map((c) => (
                        <li key={c.id} className="text-sm">
                          <span className="font-bold">{c.authorName}</span>{" "}
                          <span className="text-xs text-[var(--dim)]">{timeAgo(c.createdAt)}</span>
                          <span className="block leading-relaxed text-slate-300">{c.body}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if ((commentDrafts[post.id] ?? "").trim()) comment.mutate(post.id);
                    }}
                  >
                    <label className="flex-1">
                      <span className="sr-only">Tulis komentar untuk {post.title}</span>
                      <input
                        value={commentDrafts[post.id] ?? ""}
                        onChange={(e) => setCommentDrafts({ ...commentDrafts, [post.id]: e.target.value })}
                        maxLength={1000}
                        placeholder="Tulis komentar…"
                        className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={comment.isPending}
                      className="rounded-xl bg-[var(--accent)] px-3.5 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
                    >
                      Kirim
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bantuan
// ---------------------------------------------------------------------------

export function HelpView() {
  const [open, setOpen] = useState(0);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Bantuan</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Panduan lengkap, FAQ, dan cara menghubungi tim Dadiweb.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          { icon: "book", color: "#2E6BFF", title: "Panduan Lengkap", desc: "Pelajari cara menggunakan Dadiweb" },
          { icon: "play", color: "#7C4DFF", title: "Video Tutorial", desc: "Belajar langkah demi langkah lewat FAQ di bawah" },
          { icon: "chat", color: "#0EA5E9", title: "Tanya AI Assistant", desc: "Dapatkan bantuan langsung di Buat dengan AI" },
        ].map((c) => (
          <article
            key={c.title}
            className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4"
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
              style={{ background: c.color }}
            >
              <Icon name={c.icon} size={18} />
            </span>
            <p className="mt-3 text-sm font-bold">{c.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">{c.desc}</p>
          </article>
        ))}
      </div>

      <section className="mt-6">
        <h2 className="text-lg font-bold">Pertanyaan yang Sering Diajukan</h2>
        <div className="mt-3 space-y-2">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={item.q}
                className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)]"
              >
                <button
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-bold"
                >
                  {item.q}
                  <span
                    className={`shrink-0 text-[var(--dim)] transition-transform ${isOpen ? "rotate-45" : ""}`}
                  >
                    <Icon name="plus" size={16} />
                  </span>
                </button>
                {isOpen && (
                  <p className="dw-rise px-4 pb-4 text-sm leading-relaxed text-[var(--dim)]">
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pengaturan
// ---------------------------------------------------------------------------

function EmailVerificationSection({ state, token }: { state: State; token: string }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const verified = state.workspace.emailVerified;

  const requestVerify = useMutation({
    mutationFn: () => api.requestEmailVerification({ token }),
    onSuccess: (res) => {
      if (res.ok) {
        setError(null);
        setNotice(
          res.alreadyVerified
            ? "Email kamu sudah terverifikasi."
            : "Token verifikasi baru diterbitkan ke kotak masuk simulasi di bawah (berlaku 24 jam, sekali pakai).",
        );
        void queryClient.invalidateQueries({ queryKey: ["simulated-inbox"] });
      } else {
        setNotice(null);
        setError(res.error ?? "Gagal meminta token verifikasi.");
      }
    },
    onError: () => setError("Tidak bisa terhubung. Coba lagi sebentar lagi."),
  });

  const verifyWithToken = useMutation({
    mutationFn: (t: string) => api.verifyEmailWithToken({ token: t }),
    onSuccess: (res) => {
      if (res.ok) {
        setError(null);
        setNotice("Email berhasil diverifikasi. Terima kasih!");
        void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
        void queryClient.invalidateQueries({ queryKey: ["simulated-inbox"] });
      } else {
        setNotice(null);
        setError(res.error ?? "Verifikasi gagal.");
      }
    },
    onError: () => setError("Tidak bisa terhubung. Coba lagi sebentar lagi."),
  });

  return (
    <section className="mt-4 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <h2 className="text-[15px] font-bold">Verifikasi Email</h2>
      {verified ? (
        <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1.5 text-sm font-bold text-emerald-300">
          <Icon name="check" size={14} /> Email Terverifikasi — {state.workspace.email}
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
            Email <strong className="text-slate-200">{state.workspace.email}</strong>{" "}
            belum terverifikasi. Minta token verifikasi, lalu pakai token dari
            kotak masuk simulasi — token berlaku 24 jam dan hanya bisa dipakai
            sekali. Mengganti email akan mengulang verifikasi.
          </p>
          <button
            onClick={() => requestVerify.mutate()}
            disabled={requestVerify.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
          >
            <Icon name="mail" size={15} />
            {requestVerify.isPending ? "Mengirim…" : "Kirim Token Verifikasi"}
          </button>
          {notice && (
            <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>
          )}
          <div className="mt-4">
            <SimulatedInbox
              email={state.workspace.email}
              purpose="verify_email"
              actionLabel={verifyWithToken.isPending ? "Memverifikasi…" : "Verifikasi Email Saya"}
              onUseToken={(t) => verifyWithToken.mutate(t)}
            />
          </div>
        </>
      )}
    </section>
  );
}

export function SettingsView({ state, token, onLogout }: { state: State; token: string; onLogout?: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    displayName: state.workspace.displayName,
    email: state.workspace.email,
  });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.updateProfile({ token, ...form }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
    },
  });

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const changePw = useMutation({
    mutationFn: () =>
      api.changePassword({ token, currentPassword: pw.current, newPassword: pw.next }),
    onSuccess: (res) => {
      if (res.ok) {
        setPw({ current: "", next: "", confirm: "" });
        setPwError(null);
        setPwNotice("Kata sandi berhasil diganti. Sesi di perangkat lain sudah dicabut.");
      } else {
        setPwNotice(null);
        setPwError(res.error ?? "Gagal mengganti kata sandi.");
      }
    },
    onError: () => setPwError("Tidak bisa terhubung. Coba lagi sebentar lagi."),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">Pengaturan</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Profil akun yang sedang masuk — tersimpan dan dipakai di seluruh
        workspace.
      </p>

      <form
        className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          save.mutate();
        }}
      >
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#2E6BFF] to-[#7C4DFF] text-2xl font-extrabold text-white">
            {form.displayName.charAt(0) || "B"}
          </span>
          <div>
            <p className="font-bold">{state.workspace.displayName}</p>
            <p className="text-sm text-[var(--dim)]">{state.workspace.email}</p>
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-400">
              <Icon name="crown" size={11} /> {state.workspace.plan}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Nama lengkap</span>
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
              maxLength={60}
              className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              maxLength={120}
              className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
        </div>

        {saved && (
          <p role="status" className="mt-3 text-sm text-emerald-300">
            Profil tersimpan.
          </p>
        )}
        {save.isError && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            Gagal menyimpan profil — {save.error instanceof Error ? save.error.message : "periksa format email."}
          </p>
        )}
        <button
          type="submit"
          disabled={save.isPending}
          className="mt-4 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-5 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
        >
          {save.isPending ? "Menyimpan…" : "Simpan Perubahan"}
        </button>
      </form>

      <EmailVerificationSection state={state} token={token} />

      <form
        className="mt-4 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setPwNotice(null);
          setPwError(null);
          if (pw.next.length < 8) return setPwError("Kata sandi baru minimal 8 karakter.");
          if (pw.next !== pw.confirm) return setPwError("Konfirmasi kata sandi baru tidak sama.");
          if (pw.next === pw.current) return setPwError("Kata sandi baru harus berbeda dari yang lama.");
          changePw.mutate();
        }}
      >
        <h2 className="text-[15px] font-bold">Keamanan — Ganti Kata Sandi</h2>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Setelah diganti, sesi masuk di perangkat lain dicabut otomatis.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Kata sandi saat ini</span>
            <input
              type="password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              required
              autoComplete="current-password"
              className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Kata sandi baru</span>
            <input
              type="password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--dim)]">Konfirmasi baru</span>
            <input
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3 py-2.5 text-sm text-white focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
        </div>
        {pwNotice && (
          <p role="status" className="mt-3 text-sm text-emerald-300">{pwNotice}</p>
        )}
        {pwError && (
          <p role="alert" className="mt-3 text-sm text-rose-300">{pwError}</p>
        )}
        <button
          type="submit"
          disabled={changePw.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/8 px-4 py-2.5 text-sm font-bold ring-1 ring-[var(--border)] transition hover:bg-white/12 disabled:opacity-60"
        >
          <Icon name="shield" size={15} />
          {changePw.isPending ? "Memproses…" : "Ganti Kata Sandi"}
        </button>
      </form>

      <section className="mt-4 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <h2 className="text-[15px] font-bold">Sesi Masuk</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
          Kamu masuk sebagai {state.workspace.displayName} ({state.workspace.email}).
          Sesi berlaku 30 hari dan tersimpan di perangkat ini. Keluar akan
          mencabut sesi ini — kamu perlu masuk lagi untuk membuka workspace.
        </p>
        {onLogout && (
          <button
            onClick={onLogout}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-500/15 px-4 py-2.5 text-sm font-bold text-rose-300 ring-1 ring-rose-500/30 transition hover:bg-rose-500/25"
          >
            <Icon name="logout" size={15} /> Keluar dari Akun
          </button>
        )}
      </section>

      <section className="mt-4 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <h2 className="text-[15px] font-bold">Menu Pengaturan Lainnya</h2>
        <ul className="mt-3 divide-y divide-[var(--border-soft)] text-sm">
          {[
            { icon: "bell", label: "Notifikasi", note: "Panel notifikasi ada di ikon lonceng pada header" },
            { icon: "globe", label: "Bahasa & Tampilan", note: "Bahasa Indonesia · Mode gelap" },
            { icon: "shield", label: "Keamanan Akun", note: "Ganti kata sandi di formulir di atas" },
            { icon: "card", label: "Billing & Langganan", note: "Lihat di menu Kredit & Langganan" },
          ].map((row) => (
            <li key={row.label} className="flex items-center gap-3 py-3">
              <Icon name={row.icon} size={17} className="text-[var(--dim)]" />
              <span className="flex-1 font-semibold">{row.label}</span>
              <span className="text-xs text-[var(--dim)]">{row.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// G3 — Panel Admin katalog skill: versi aktif, status aktif/nonaktif
// (berlaku langsung ke routing), rincian biaya di dalam paket generate 300
// yang tetap, skor eval golden set, riwayat perubahan status, dan antrean
// kandidat skill baru dari prompt generik.
// ---------------------------------------------------------------------------

export function SkillCatalogPanel({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: ["admin-skill-catalog", token],
    queryFn: () => api.getAdminSkillCatalog({ token }),
  });
  const [evalInputs, setEvalInputs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["admin-skill-catalog"] });
  const toggleActive = useMutation({
    mutationFn: (args: { skillName: string; isActive: boolean }) =>
      api.setSkillActive({ token, ...args }),
    onSuccess: (res) => {
      setNotice(
        res.ok
          ? `Skill ${res.skillName} sekarang ${res.isActive ? "AKTIF — routing memakainya lagi" : "NONAKTIF — routing tidak lagi memakainya (fallback ke skill lain / mode generik)"}. Berlaku langsung tanpa deploy ulang.`
          : (res.error ?? "Gagal mengubah status skill."),
      );
      invalidate();
    },
    onError: (e) =>
      setNotice(e instanceof Error ? e.message : "Gagal mengubah status skill."),
  });
  const saveEval = useMutation({
    mutationFn: (args: { skillName: string; score: number | null }) =>
      api.setSkillEvalScore({ token, ...args }),
    onSuccess: (res) => {
      setNotice(
        res.ok
          ? res.evalScore === null
            ? `Skor eval ${res.skillName} dihapus — kembali belum dievaluasi.`
            : `Skor eval ${res.skillName} tercatat: ${res.evalScore} / 100.`
          : (res.error ?? "Gagal mencatat skor eval."),
      );
      invalidate();
    },
    onError: (e) =>
      setNotice(e instanceof Error ? e.message : "Gagal mencatat skor eval."),
  });
  const data = catalog.data;
  return (
    <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <h2 className="text-[15px] font-bold">Katalog Skill AI (G3–G4) — 30 Skill</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Versi aktif, status, rincian biaya, dan skor eval setiap skill.
        Menonaktifkan skill berlaku langsung ke routing (tanpa deploy ulang):
        router tidak lagi memakainya dan jatuh ke skill lain atau mode
        generik &quot;proyek kustom&quot;.
      </p>
      {data && (
        <p className="mt-2 rounded-xl bg-white/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-300">
          <strong className="text-white">Rincian biaya — bukan tarif baru:</strong>{" "}
          {data.costNote} Total satu komposisi generate:{" "}
          <strong className="tnum text-white">{data.compositionTotal} kredit</strong>.
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {catalog.isPending ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Memuat katalog skill…</p>
      ) : !data?.isAdmin ? (
        <p className="mt-3 text-sm text-[var(--dim)]">
          Katalog skill lengkap hanya bisa dilihat dan diubah akun admin.
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-[var(--border-soft)]">
            {data.skills.map((s) => (
              <li key={s.name} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-bold">{s.name}</span>
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-[var(--dim)]">
                    v{s.version}
                  </span>
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-[var(--dim)]">
                    {s.priority} · {s.family || "—"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-300"}`}
                  >
                    {s.isActive ? "Aktif" : "Nonaktif"}
                  </span>
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                    {s.evalScore === null ? "belum dievaluasi" : `Eval ${s.evalScore} / 100`}
                  </span>
                  <button
                    onClick={() =>
                      toggleActive.mutate({ skillName: s.name, isActive: !s.isActive })
                    }
                    disabled={toggleActive.isPending}
                    aria-label={`${s.isActive ? "Nonaktifkan" : "Aktifkan"} skill ${s.name}`}
                    className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-60 ${s.isActive ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25" : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"}`}
                  >
                    {s.isActive ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </div>
                <p className="mt-1 truncate text-[13px] text-[var(--dim)]">{s.title}</p>
                <p className="mt-1 text-[13px] text-[var(--dim)]">
                  Rincian dalam paket 300: Planner {s.costBreakdown.planner} · Designer{" "}
                  {s.costBreakdown.designer} · Coder {s.costBreakdown.coder} · Builder{" "}
                  {s.costBreakdown.builder} · Fixer {s.costBreakdown.fixer} ={" "}
                  <strong className="tnum text-slate-200">{s.costBreakdown.total}</strong>{" "}
                  (jatah skill ini bila jadi skill utama; total komposisi tetap 300)
                </p>
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const raw = (evalInputs[s.name] ?? "").trim();
                    if (raw === "") return;
                    const score = Number(raw);
                    if (!Number.isFinite(score) || score < 0 || score > 100) {
                      setNotice(`Skor eval untuk ${s.name} harus angka 0–100.`);
                      return;
                    }
                    saveEval.mutate({ skillName: s.name, score });
                  }}
                >
                  <label className="flex items-center gap-2 text-xs font-semibold text-[var(--dim)]">
                    Skor eval golden set (0–100)
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={evalInputs[s.name] ?? (s.evalScore !== null ? String(s.evalScore) : "")}
                      onChange={(e) =>
                        setEvalInputs({ ...evalInputs, [s.name]: e.target.value })
                      }
                      placeholder="belum dievaluasi"
                      aria-label={`Skor eval untuk skill ${s.name}`}
                      className="w-28 rounded-lg border border-[var(--border)] bg-[#0A1130] px-2.5 py-1.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={saveEval.isPending}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white hover:brightness-110 disabled:opacity-60"
                  >
                    Catat Skor Eval
                  </button>
                  {s.evalScore !== null && (
                    <button
                      type="button"
                      onClick={() => saveEval.mutate({ skillName: s.name, score: null })}
                      disabled={saveEval.isPending}
                      className="rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12 disabled:opacity-60"
                    >
                      Hapus Skor
                    </button>
                  )}
                </form>
              </li>
            ))}
          </ul>

          <h3 className="mt-5 text-sm font-bold">Riwayat Perubahan Status &amp; Eval</h3>
          {data.statusLog.length === 0 ? (
            <p className="mt-1.5 text-sm text-[var(--dim)]">
              Belum ada perubahan status atau skor eval yang tercatat.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--border-soft)]">
              {data.statusLog.slice(0, 12).map((l) => (
                <li key={l.id} className="py-2 text-[13px]">
                  <span className="font-mono font-bold">{l.skillName}</span>{" "}
                  <span className="text-[var(--dim)]">
                    · {l.action} · {timeAgo(l.createdAt)}
                  </span>
                  <span className="block text-slate-300">{l.detail}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-5 text-sm font-bold">Antrean Kandidat Skill Baru</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
            Prompt yang tidak menemukan domain aktif berskor &gt;0 tercatat di
            sini untuk ditinjau admin. Prompt-nya sendiri tetap berjalan
            sebagai mode generik &quot;proyek kustom&quot; (desain-ui +
            database-designer) — tidak digagalkan.
          </p>
          {data.candidates.length === 0 ? (
            <p className="mt-1.5 text-sm text-[var(--dim)]">
              Belum ada kandidat tercatat — semua prompt yang dipratinjau cocok
              dengan skill yang ada.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--border-soft)]">
              {data.candidates.slice(0, 12).map((c) => (
                <li key={c.id} className="py-2 text-[13px]">
                  <span className="block leading-relaxed text-slate-200">“{c.prompt}”</span>
                  <span className="text-[var(--dim)]">
                    {timeAgo(c.createdAt)} · skill terdekat:{" "}
                    {c.nearestSkill
                      ? `${c.nearestSkill} (skor ${c.nearestScore})`
                      : "tidak ada (semua skor 0)"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Model AI & Provider (G5-B; G6 menambah stage responder) — panel admin
// untuk provider DeepInfra: status kunci, registry model 5 tahap pipeline
// + responder chat perencana, uji koneksi, dan log pemakaian.
// ---------------------------------------------------------------------------

const AI_STAGE_LABELS: Record<string, string> = {
  planner: "Planner — Perencana",
  designer: "Designer — Arsitektur & Desain",
  coder: "Coder — Penulisan Kode",
  builder: "Builder & Tester — Perakitan",
  fixer: "Fixer — Perbaikan",
  // G6 — Responder chat perencana (bukan tahap pipeline build).
  responder: "Responder — Penjawab Chat Perencana",
  "uji-koneksi": "Uji Koneksi",
};

const AI_STATUS_LABELS: Record<string, string> = {
  sukses: "Sukses",
  gagal: "Gagal",
  kunci_belum_terpasang: "Kunci Belum Terpasang",
};

function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}

interface AiStageRowData {
  stage: string;
  provider: string;
  primaryModel: string;
  fallbackModel: string;
  isActive: boolean;
  inputPriceUsd: number;
  outputPriceUsd: number;
  fallbackInputPriceUsd: number;
  fallbackOutputPriceUsd: number;
  updatedAt: string;
}

const aiInputCls =
  "rounded-lg border border-[var(--border)] bg-[#0A1130] px-2.5 py-1.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none";

function AiStageRow({
  token,
  stage,
  onNotice,
  onTest,
  testingModel,
}: {
  token: string;
  stage: AiStageRowData;
  onNotice: (msg: string) => void;
  onTest: (model: string, stageKey: string) => void;
  testingModel: string | null;
}) {
  const queryClient = useQueryClient();
  const [primaryModel, setPrimaryModel] = useState(stage.primaryModel);
  const [fallbackModel, setFallbackModel] = useState(stage.fallbackModel);
  const [inputPrice, setInputPrice] = useState(String(stage.inputPriceUsd));
  const [outputPrice, setOutputPrice] = useState(String(stage.outputPriceUsd));
  const [fbInputPrice, setFbInputPrice] = useState(String(stage.fallbackInputPriceUsd));
  const [fbOutputPrice, setFbOutputPrice] = useState(String(stage.fallbackOutputPriceUsd));

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["admin-ai-settings"] });

  const save = useMutation({
    mutationFn: () =>
      api.updateAiStageModel({
        token,
        stage: stage.stage as "planner" | "designer" | "coder" | "builder" | "fixer" | "responder",
        primaryModel: primaryModel.trim(),
        fallbackModel: fallbackModel.trim(),
        inputPriceUsd: Number(inputPrice),
        outputPriceUsd: Number(outputPrice),
        fallbackInputPriceUsd: Number(fbInputPrice),
        fallbackOutputPriceUsd: Number(fbOutputPrice),
      }),
    onSuccess: (res) => {
      onNotice(
        res.ok
          ? `Registry tahap ${stage.stage} diperbarui: model utama ${primaryModel.trim()}, fallback ${fallbackModel.trim()}.`
          : (res.error ?? "Gagal memperbarui registry model."),
      );
      invalidate();
    },
    onError: (e) =>
      onNotice(e instanceof Error ? e.message : "Gagal memperbarui registry model."),
  });

  const toggle = useMutation({
    mutationFn: () =>
      api.updateAiStageModel({
        token,
        stage: stage.stage as "planner" | "designer" | "coder" | "builder" | "fixer" | "responder",
        isActive: !stage.isActive,
      }),
    onSuccess: (res) => {
      onNotice(
        res.ok
          ? `Tahap ${stage.stage} sekarang ${stage.isActive ? "NONAKTIF — pipeline langsung memakai model fallback tahap ini" : "AKTIF — model utama dipakai lagi"}.`
          : (res.error ?? "Gagal mengubah status tahap."),
      );
      invalidate();
    },
    onError: (e) =>
      onNotice(e instanceof Error ? e.message : "Gagal mengubah status tahap."),
  });

  const submitSave = (e: FormEvent) => {
    e.preventDefault();
    if (!primaryModel.trim() || !fallbackModel.trim()) {
      onNotice("Model utama dan model fallback tidak boleh kosong.");
      return;
    }
    const prices = [inputPrice, outputPrice, fbInputPrice, fbOutputPrice].map(Number);
    if (prices.some((p) => !Number.isFinite(p) || p < 0)) {
      onNotice("Harga harus angka 0 atau lebih (USD per 1 juta token).");
      return;
    }
    save.mutate();
  };

  return (
    <li className="py-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{AI_STAGE_LABELS[stage.stage] ?? stage.stage}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${stage.isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-300"}`}
        >
          {stage.isActive ? "Aktif" : "Nonaktif"}
        </span>
        <button
          onClick={() => toggle.mutate()}
          disabled={toggle.isPending}
          aria-label={`${stage.isActive ? "Nonaktifkan" : "Aktifkan"} tahap ${stage.stage}`}
          className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-60 ${stage.isActive ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25" : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"}`}
        >
          {stage.isActive ? "Nonaktifkan" : "Aktifkan"}
        </button>
      </div>
      <form onSubmit={submitSave} className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-[var(--dim)]">
          Model utama
          <span className="mt-1 flex gap-2">
            <input
              value={primaryModel}
              onChange={(e) => setPrimaryModel(e.target.value)}
              aria-label={`Model utama tahap ${stage.stage}`}
              className={`${aiInputCls} min-w-0 flex-1 font-mono text-[13px]`}
            />
            <button
              type="button"
              onClick={() => onTest(stage.primaryModel, stage.stage)}
              disabled={testingModel !== null}
              className="shrink-0 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12 disabled:opacity-60"
            >
              {testingModel === stage.primaryModel ? "Menguji…" : "Uji Koneksi"}
            </button>
          </span>
        </label>
        <label className="block text-xs font-semibold text-[var(--dim)]">
          Model fallback
          <span className="mt-1 flex gap-2">
            <input
              value={fallbackModel}
              onChange={(e) => setFallbackModel(e.target.value)}
              aria-label={`Model fallback tahap ${stage.stage}`}
              className={`${aiInputCls} min-w-0 flex-1 font-mono text-[13px]`}
            />
            <button
              type="button"
              onClick={() => onTest(stage.fallbackModel, stage.stage)}
              disabled={testingModel !== null}
              className="shrink-0 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12 disabled:opacity-60"
            >
              {testingModel === stage.fallbackModel ? "Menguji…" : "Uji Koneksi"}
            </button>
          </span>
        </label>
        <label className="block text-xs font-semibold text-[var(--dim)]">
          Harga input model utama (USD / 1 jt token)
          <input
            type="number"
            min={0}
            step="any"
            value={inputPrice}
            onChange={(e) => setInputPrice(e.target.value)}
            aria-label={`Harga input model utama tahap ${stage.stage}`}
            className={`${aiInputCls} mt-1 w-full tnum`}
          />
        </label>
        <label className="block text-xs font-semibold text-[var(--dim)]">
          Harga output model utama (USD / 1 jt token)
          <input
            type="number"
            min={0}
            step="any"
            value={outputPrice}
            onChange={(e) => setOutputPrice(e.target.value)}
            aria-label={`Harga output model utama tahap ${stage.stage}`}
            className={`${aiInputCls} mt-1 w-full tnum`}
          />
        </label>
        <label className="block text-xs font-semibold text-[var(--dim)]">
          Harga input fallback (USD / 1 jt token)
          <input
            type="number"
            min={0}
            step="any"
            value={fbInputPrice}
            onChange={(e) => setFbInputPrice(e.target.value)}
            aria-label={`Harga input fallback tahap ${stage.stage}`}
            className={`${aiInputCls} mt-1 w-full tnum`}
          />
        </label>
        <label className="block text-xs font-semibold text-[var(--dim)]">
          Harga output fallback (USD / 1 jt token)
          <input
            type="number"
            min={0}
            step="any"
            value={fbOutputPrice}
            onChange={(e) => setFbOutputPrice(e.target.value)}
            aria-label={`Harga output fallback tahap ${stage.stage}`}
            className={`${aiInputCls} mt-1 w-full tnum`}
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-bold text-white hover:brightness-110 disabled:opacity-60"
          >
            {save.isPending ? "Menyimpan…" : `Simpan Perubahan Tahap ${stage.stage}`}
          </button>
        </div>
      </form>
    </li>
  );
}

export function AiProviderPanel({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin-ai-settings", token],
    queryFn: () => api.getAiProviderSettings({ token }),
  });
  const s = settings.data;
  const [notice, setNotice] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [confirmClearKey, setConfirmClearKey] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  const [fModel, setFModel] = useState("");
  const [fStage, setFStage] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [applied, setApplied] = useState({
    model: "",
    stage: "",
    status: "",
    startDate: "",
    endDate: "",
  });
  const usage = useQuery({
    queryKey: ["admin-ai-usage", token, applied],
    queryFn: () =>
      api.getAiUsage({
        token,
        model: applied.model || undefined,
        stage:
          applied.stage === ""
            ? undefined
            : (applied.stage as "planner" | "designer" | "coder" | "builder" | "fixer" | "responder"),
        status:
          applied.status === ""
            ? undefined
            : (applied.status as "sukses" | "gagal" | "kunci_belum_terpasang"),
        startDate: applied.startDate || undefined,
        endDate: applied.endDate || undefined,
      }),
  });
  const u = usage.data;

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-ai-settings"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-ai-usage"] });
  };

  const setKey = useMutation({
    mutationFn: () => api.setDeepInfraKey({ token, apiKey: keyInput }),
    onSuccess: (res) => {
      if (res.ok) {
        setKeyInput("");
        setNotice(
          `Kunci DeepInfra terpasang dan tersimpan terenkripsi (petunjuk: ${res.keyHint}). Nilai kunci tidak pernah ditampilkan lagi.`,
        );
      } else {
        setNotice(res.error ?? "Gagal memasang kunci DeepInfra.");
      }
      invalidateAll();
    },
    onError: (e) =>
      setNotice(e instanceof Error ? e.message : "Gagal memasang kunci DeepInfra."),
  });

  const clearKey = useMutation({
    mutationFn: () => api.clearDeepInfraKey({ token }),
    onSuccess: (res) => {
      setConfirmClearKey(false);
      setNotice(
        res.ok
          ? "Kunci DeepInfra dicabut. Generate kembali berstatus belum aktif sampai kunci baru dipasang."
          : (res.error ?? "Gagal mencabut kunci DeepInfra."),
      );
      invalidateAll();
    },
    onError: (e) =>
      setNotice(e instanceof Error ? e.message : "Gagal mencabut kunci DeepInfra."),
  });

  const testConn = useMutation({
    mutationFn: (args: { model: string; stage: string }) =>
      api.testAiModelConnection({
        token,
        model: args.model,
        stage:
          args.stage === ""
            ? undefined
            : (args.stage as "planner" | "designer" | "coder" | "builder" | "fixer" | "responder"),
      }),
    onSuccess: (res) => {
      setTestResults((prev) => ({
        ...prev,
        [res.model]: res.ok
          ? `✓ ${res.message} Token ${fmtNum(res.inputTokens)} masuk / ${fmtNum(res.outputTokens)} keluar · biaya ${fmtUsd(res.costUsd)}.`
          : `✗ ${res.message}`,
      }));
      void queryClient.invalidateQueries({ queryKey: ["admin-ai-usage"] });
    },
    onError: (e) =>
      setNotice(e instanceof Error ? e.message : "Uji koneksi gagal dijalankan."),
  });

  return (
    <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <h2 className="text-[15px] font-bold">Model AI &amp; Provider (G5)</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Provider tunggal: <strong className="text-slate-200">DeepInfra</strong>{" "}
        (OpenAI-compatible). Semua tahap pipeline memakai model dari provider
        ini; kunci API disimpan terenkripsi AES-256-GCM dan hanya 4 karakter
        terakhirnya yang tampil sebagai petunjuk. Setiap pemanggilan model —
        termasuk uji koneksi — tercatat di log pemakaian beserta biayanya.
      </p>
      {notice && (
        <p role="status" className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {settings.isPending ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Memuat pengaturan provider…</p>
      ) : !s?.isAdmin ? (
        <p className="mt-3 text-sm text-[var(--dim)]">
          Pengaturan model AI &amp; provider hanya bisa dilihat dan diubah akun admin.
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">Kunci API DeepInfra</span>
              {s.keyConfigured ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                  Terpasang · {s.keyHint}
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                  Belum terpasang — generate AI belum aktif
                </span>
              )}
            </div>
            {s.keyConfigured ? (
              <div className="mt-3">
                {!confirmClearKey ? (
                  <button
                    onClick={() => setConfirmClearKey(true)}
                    className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/25"
                  >
                    Hapus Kunci
                  </button>
                ) : (
                  <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[13px] text-rose-200">
                    Cabut kunci DeepInfra? Generate akan kembali nonaktif
                    sampai kunci baru dipasang.
                    <span className="ml-3 inline-flex gap-2">
                      <button
                        onClick={() => clearKey.mutate()}
                        disabled={clearKey.isPending}
                        className="font-bold underline underline-offset-2 disabled:opacity-60"
                      >
                        {clearKey.isPending ? "Mencabut…" : "Ya, cabut kunci"}
                      </button>
                      <button
                        onClick={() => setConfirmClearKey(false)}
                        className="font-bold underline underline-offset-2"
                      >
                        Batal
                      </button>
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <form
                className="mt-3 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (keyInput.trim().length < 8) {
                    setNotice("Kunci DeepInfra terlalu pendek — periksa kembali kunci yang dimasukkan.");
                    return;
                  }
                  setKey.mutate();
                }}
              >
                <label className="sr-only" htmlFor="deepinfra-key-input">
                  Kunci API DeepInfra baru
                </label>
                <input
                  id="deepinfra-key-input"
                  type="password"
                  autoComplete="off"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Tempel kunci API DeepInfra…"
                  className={`${aiInputCls} min-w-0 flex-1`}
                />
                <button
                  type="submit"
                  disabled={setKey.isPending}
                  className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-white hover:brightness-110 disabled:opacity-60"
                >
                  {setKey.isPending ? "Memasang…" : "Pasang Kunci"}
                </button>
              </form>
            )}
            <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
              Kunci tersimpan terenkripsi di server dan tidak pernah
              ditampilkan utuh, diekspor, atau dicatat di log.
            </p>
          </div>

          <h3 className="mt-5 text-sm font-bold">Registry Model per Tahap</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
            Model utama dicoba satu kali; bila gagal, model fallback tahap itu
            dicoba satu kali. Menonaktifkan tahap membuat pipeline langsung
            memakai fallback-nya. Harga dipakai untuk menghitung biaya setiap
            panggilan di log pemakaian.
          </p>
          <ul className="mt-2 divide-y divide-[var(--border-soft)]">
            {s.stages.map((st) => (
              <AiStageRow
                key={`${st.stage}-${st.updatedAt}`}
                token={token}
                stage={st}
                onNotice={setNotice}
                onTest={(model, stageKey) =>
                  testConn.mutate({ model, stage: stageKey })
                }
                testingModel={testConn.isPending ? (testConn.variables?.model ?? null) : null}
              />
            ))}
          </ul>
          {Object.entries(testResults).map(([model, text]) => (
            <p
              key={model}
              role="status"
              className="mt-2 rounded-xl bg-white/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-200"
            >
              <span className="font-mono font-bold">{model}</span> — {text}
            </p>
          ))}

          <h3 className="mt-5 text-sm font-bold">Log Pemakaian AI</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
            Semua panggilan model dari pipeline generate dan uji koneksi,
            terbaru dulu. Total dihitung dari seluruh baris yang cocok dengan
            filter; daftar menampilkan maksimal 100 entri.
          </p>
          <form
            className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied({
                model: fModel.trim(),
                stage: fStage,
                status: fStatus,
                startDate: fStart,
                endDate: fEnd,
              });
            }}
          >
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Filter model
              <input
                value={fModel}
                onChange={(e) => setFModel(e.target.value)}
                placeholder="mis. DeepSeek"
                aria-label="Filter log pemakaian berdasarkan model"
                className={`${aiInputCls} mt-1 w-full`}
              />
            </label>
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Tahap
              <select
                value={fStage}
                onChange={(e) => setFStage(e.target.value)}
                aria-label="Filter log pemakaian berdasarkan tahap"
                className={`${aiInputCls} mt-1 w-full`}
              >
                <option value="">Semua tahap</option>
                <option value="planner">Planner</option>
                <option value="designer">Designer</option>
                <option value="coder">Coder</option>
                <option value="builder">Builder</option>
                <option value="fixer">Fixer</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Status
              <select
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
                aria-label="Filter log pemakaian berdasarkan status"
                className={`${aiInputCls} mt-1 w-full`}
              >
                <option value="">Semua status</option>
                <option value="sukses">Sukses</option>
                <option value="gagal">Gagal</option>
                <option value="kunci_belum_terpasang">Kunci belum terpasang</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Tanggal mulai
              <input
                type="date"
                value={fStart}
                onChange={(e) => setFStart(e.target.value)}
                aria-label="Filter log pemakaian dari tanggal"
                className={`${aiInputCls} mt-1 w-full`}
              />
            </label>
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Tanggal akhir
              <input
                type="date"
                value={fEnd}
                onChange={(e) => setFEnd(e.target.value)}
                aria-label="Filter log pemakaian sampai tanggal"
                className={`${aiInputCls} mt-1 w-full`}
              />
            </label>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
              <button
                type="submit"
                className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-white hover:brightness-110"
              >
                Terapkan Filter
              </button>
              <button
                type="button"
                onClick={() => {
                  setFModel("");
                  setFStage("");
                  setFStatus("");
                  setFStart("");
                  setFEnd("");
                  setApplied({ model: "", stage: "", status: "", startDate: "", endDate: "" });
                }}
                className="rounded-lg bg-white/8 px-3.5 py-2 text-xs font-bold hover:bg-white/12"
              >
                Reset Filter
              </button>
            </div>
          </form>

          {usage.isPending ? (
            <p className="mt-3 text-sm text-[var(--dim)]">Memuat log pemakaian…</p>
          ) : !u?.isAdmin ? (
            <p className="mt-3 text-sm text-[var(--dim)]">
              Log pemakaian AI hanya bisa dilihat akun admin.
            </p>
          ) : (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Total Panggilan (sesuai filter)", value: fmtNum(u.totals.totalCalls) },
                  { label: "Total Token Masuk", value: fmtNum(u.totals.totalInputTokens) },
                  { label: "Total Token Keluar", value: fmtNum(u.totals.totalOutputTokens) },
                  { label: "Total Biaya", value: fmtUsd(u.totals.totalCostUsd) },
                ].map((t) => (
                  <div
                    key={t.label}
                    className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-3.5"
                  >
                    <p className="text-xl font-extrabold tnum">{t.value}</p>
                    <p className="mt-0.5 text-xs text-[var(--dim)]">{t.label}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[13px] text-[var(--dim)]">
                Rincian per status:{" "}
                {u.totals.byStatus
                  .map(
                    (b) =>
                      `${AI_STATUS_LABELS[b.status] ?? b.status} ${fmtNum(b.calls)} panggilan (${fmtUsd(b.costUsd)})`,
                  )
                  .join(" · ")}
              </p>
              {u.entries.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--dim)]">
                  Belum ada entri pemakaian yang cocok dengan filter ini.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--border-soft)]">
                  {u.entries.map((en) => (
                    <li key={en.id} className="py-2.5 text-[13px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold">{en.model || "—"}</span>
                        <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-[var(--dim)]">
                          {AI_STAGE_LABELS[en.stage] ?? en.stage}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            en.status === "sukses"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : en.status === "gagal"
                                ? "bg-rose-500/15 text-rose-300"
                                : "bg-amber-500/15 text-amber-300"
                          }`}
                        >
                          {AI_STATUS_LABELS[en.status] ?? en.status}
                        </span>
                        <span className="ml-auto text-xs text-[var(--dim)]">
                          {new Date(en.createdAt).toLocaleString("id-ID", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="mt-1 text-[var(--dim)]">
                        Token {fmtNum(en.inputTokens)} masuk / {fmtNum(en.outputTokens)}{" "}
                        keluar · biaya {fmtUsd(en.costUsd)} · latensi {fmtNum(en.latencyMs)} ms
                        {en.projectId !== null ? ` · proyek #${en.projectId}` : ""}
                        {en.userId !== null ? ` · pengguna #${en.userId}` : ""}
                      </p>
                      {en.detail && (
                        <p className="mt-0.5 leading-relaxed text-slate-300">{en.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Admin Panel
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// G8 — Panel Login Google (OAuth) di modul Pengaturan Platform.
// Dipasang di atas AdminCompletePanel bagian "platform" (lihat
// views-admin.tsx): kredensial disimpan terenkripsi AES-256-GCM pola
// DeepInfra, Client ID & redirect URI tampil penuh (bukan rahasia),
// secret hanya petunjuk 4 karakter terakhir. Login Google sungguhan
// baru bisa dites setelah domain dadiweb.id terdaftar dan redirect URI
// HTTPS didaftarkan ke client Google — panel ini hanya menyiapkan
// implementasinya sampai titik itu.
// ---------------------------------------------------------------------------

export function GoogleOAuthPanel({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin-google-oauth-settings", token],
    queryFn: () => api.getGoogleOAuthSettings({ token }),
  });
  const s = settings.data;
  const [notice, setNotice] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin-google-oauth-settings"],
    });
  };

  const save = useMutation({
    mutationFn: () =>
      api.setGoogleOAuthSettings({
        token,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        redirectUri: redirectUri.trim(),
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setClientId("");
        setClientSecret("");
        setRedirectUri("");
        setNotice(
          `Kredensial login Google tersimpan terenkripsi (Client ID ${res.clientId}, secret ${res.secretHint}). Uji login sungguhan menunggu domain + redirect URI terdaftar.`,
        );
      } else {
        setNotice(res.error ?? "Gagal menyimpan kredensial login Google.");
      }
      invalidate();
    },
    onError: (e) =>
      setNotice(
        e instanceof Error
          ? e.message
          : "Gagal menyimpan kredensial login Google.",
      ),
  });

  const clear = useMutation({
    mutationFn: () => api.clearGoogleOAuthSettings({ token }),
    onSuccess: (res) => {
      setConfirmClear(false);
      setNotice(
        res.ok
          ? "Kredensial login Google dihapus. Tombol Google kembali menampilkan pesan belum aktif."
          : (res.error ?? "Gagal menghapus kredensial login Google."),
      );
      invalidate();
    },
    onError: (e) =>
      setNotice(
        e instanceof Error
          ? e.message
          : "Gagal menghapus kredensial login Google.",
      ),
  });

  return (
    <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <h2 className="text-[15px] font-bold">Login Google (OAuth) — G8</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Tombol Google di layar login memakai OAuth asli: pengguna diarahkan
        ke Google, lalu kembali ke aplikasi dan masuk lewat profil Google
        (akun baru dibuat paket Free bila belum ada). Client Secret
        disimpan terenkripsi AES-256-GCM dan tidak pernah ditampilkan lagi
        — yang tampil hanya 4 karakter terakhirnya. Redirect URI harus
        memakai https (Google menolak http) dan harus didaftarkan persis
        sama di Google Cloud Console; login sungguhan baru bisa dites
        setelah domain dadiweb.id terdaftar dan URI-nya didaftarkan.
      </p>
      {notice && (
        <p role="status" className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {settings.isPending ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Memuat kredensial Google…</p>
      ) : !s?.isAdmin ? (
        <p className="mt-3 text-sm text-[var(--dim)]">
          Kredensial login Google hanya bisa dilihat dan diubah akun admin.
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">Status</span>
              {s.configured ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                  Terpasang — siap diuji begitu redirect URI terdaftar
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                  Belum lengkap — tombol Google menampilkan pesan belum aktif
                </span>
              )}
            </div>
            {s.configured && (
              <dl className="mt-3 space-y-1.5 text-[13px]">
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">Client ID:</dt>
                  <dd className="break-all font-mono text-xs">{s.clientId}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">Redirect URI:</dt>
                  <dd className="break-all font-mono text-xs">{s.redirectUri}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">Client Secret:</dt>
                  <dd className="font-mono text-xs">{s.secretHint} (hanya petunjuk)</dd>
                </div>
              </dl>
            )}
            {!s.configured && s.missing.length > 0 && (
              <p className="mt-3 text-[13px] text-amber-200">
                Masih kurang:{" "}
                {s.missing
                  .map((m) =>
                    m === "clientId"
                      ? "Client ID"
                      : m === "clientSecret"
                        ? "Client Secret"
                        : "Redirect URI",
                  )
                  .join(", ")}
                .
              </p>
            )}
          </div>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (clientId.trim() === "" || clientSecret.trim().length < 8 || redirectUri.trim() === "") {
                setNotice("Lengkapi Client ID, Client Secret (minimal 8 karakter), dan Redirect URI.");
                return;
              }
              save.mutate();
            }}
          >
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">Client ID Google</span>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                maxLength={300}
                placeholder="xxxx.apps.googleusercontent.com"
                className={`${adminInputCls} w-full`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">Client Secret Google baru</span>
              <input
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                maxLength={400}
                autoComplete="off"
                placeholder="Masukkan Client Secret (disimpan terenkripsi, tidak pernah ditampilkan lagi)"
                className={`${adminInputCls} w-full`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">Redirect URI</span>
              <input
                value={redirectUri}
                onChange={(e) => setRedirectUri(e.target.value)}
                maxLength={500}
                placeholder="https://dadiweb.id/"
                className={`${adminInputCls} w-full`}
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-[var(--dim-2)]">
                Harus persis sama dengan yang didaftarkan di Google Cloud
                Console (Authorized redirect URIs). Selama domain belum
                terdaftar, isi dengan URI yang akan dipakai nanti — login
                sungguhan tetap belum bisa dites sampai URI itu aktif.
              </span>
            </label>
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {save.isPending ? "Menyimpan…" : "Simpan Kredensial Google"}
            </button>
          </form>
          {s.configured && (
            <div className="mt-3">
              {!confirmClear ? (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/25"
                >
                  Hapus Kredensial Google
                </button>
              ) : (
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[13px] text-rose-200">
                  Hapus kredensial login Google? Tombol Google kembali
                  menampilkan pesan belum aktif.
                  <span className="ml-3 inline-flex gap-2">
                    <button
                      onClick={() => clear.mutate()}
                      disabled={clear.isPending}
                      className="font-bold underline underline-offset-2 disabled:opacity-60"
                    >
                      {clear.isPending ? "Menghapus…" : "Ya, hapus"}
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="font-bold underline underline-offset-2"
                    >
                      Batal
                    </button>
                  </span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// G9 — Panel Login GitHub (OAuth) di modul Pengaturan Platform,
// berdampingan dengan panel Google (G8). Pola yang sama: kredensial
// disimpan terenkripsi AES-256-GCM pola DeepInfra, Client ID & callback
// URL tampil penuh (bukan rahasia), secret hanya petunjuk 4 karakter
// terakhir. Login GitHub sungguhan baru bisa dites setelah domain
// dadiweb.id terdaftar dan callback URL HTTPS didaftarkan di OAuth App
// GitHub — panel ini hanya menyiapkan implementasinya sampai titik itu.
// ---------------------------------------------------------------------------

export function GitHubOAuthPanel({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin-github-oauth-settings", token],
    queryFn: () => api.getGitHubOAuthSettings({ token }),
  });
  const s = settings.data;
  const [notice, setNotice] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin-github-oauth-settings"],
    });
  };

  const save = useMutation({
    mutationFn: () =>
      api.setGitHubOAuthSettings({
        token,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        callbackUrl: callbackUrl.trim(),
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setClientId("");
        setClientSecret("");
        setCallbackUrl("");
        setNotice(
          `Kredensial login GitHub tersimpan terenkripsi (Client ID ${res.clientId}, secret ${res.secretHint}). Uji login sungguhan menunggu domain + callback URL terdaftar.`,
        );
      } else {
        setNotice(res.error ?? "Gagal menyimpan kredensial login GitHub.");
      }
      invalidate();
    },
    onError: (e) =>
      setNotice(
        e instanceof Error
          ? e.message
          : "Gagal menyimpan kredensial login GitHub.",
      ),
  });

  const clear = useMutation({
    mutationFn: () => api.clearGitHubOAuthSettings({ token }),
    onSuccess: (res) => {
      setConfirmClear(false);
      setNotice(
        res.ok
          ? "Kredensial login GitHub dihapus. Tombol GitHub kembali menampilkan pesan belum aktif."
          : (res.error ?? "Gagal menghapus kredensial login GitHub."),
      );
      invalidate();
    },
    onError: (e) =>
      setNotice(
        e instanceof Error
          ? e.message
          : "Gagal menghapus kredensial login GitHub.",
      ),
  });

  return (
    <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <h2 className="text-[15px] font-bold">Login GitHub (OAuth) — G9</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Tombol GitHub di layar login memakai OAuth asli: pengguna diarahkan
        ke GitHub, lalu kembali ke aplikasi dan masuk lewat profil GitHub
        (akun baru dibuat paket Free bila belum ada; email diambil dari
        endpoint emails GitHub karena email pengguna bisa privat). Client
        Secret disimpan terenkripsi AES-256-GCM dan tidak pernah
        ditampilkan lagi — yang tampil hanya 4 karakter terakhirnya.
        Callback URL harus memakai https (GitHub menolak http) dan harus
        didaftarkan persis sama di OAuth App GitHub; login sungguhan baru
        bisa dites setelah domain dadiweb.id terdaftar dan URL-nya
        didaftarkan.
      </p>
      {notice && (
        <p role="status" className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {settings.isPending ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Memuat kredensial GitHub…</p>
      ) : !s?.isAdmin ? (
        <p className="mt-3 text-sm text-[var(--dim)]">
          Kredensial login GitHub hanya bisa dilihat dan diubah akun admin.
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">Status</span>
              {s.configured ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                  Terpasang — siap diuji begitu callback URL terdaftar
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                  Belum lengkap — tombol GitHub menampilkan pesan belum aktif
                </span>
              )}
            </div>
            {s.configured && (
              <dl className="mt-3 space-y-1.5 text-[13px]">
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">Client ID:</dt>
                  <dd className="break-all font-mono text-xs">{s.clientId}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">Callback URL:</dt>
                  <dd className="break-all font-mono text-xs">{s.callbackUrl}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">Client Secret:</dt>
                  <dd className="font-mono text-xs">{s.secretHint} (hanya petunjuk)</dd>
                </div>
              </dl>
            )}
            {!s.configured && s.missing.length > 0 && (
              <p className="mt-3 text-[13px] text-amber-200">
                Masih kurang:{" "}
                {s.missing
                  .map((m) =>
                    m === "clientId"
                      ? "Client ID"
                      : m === "clientSecret"
                        ? "Client Secret"
                        : "Callback URL",
                  )
                  .join(", ")}
                .
              </p>
            )}
          </div>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (clientId.trim() === "" || clientSecret.trim().length < 8 || callbackUrl.trim() === "") {
                setNotice("Lengkapi Client ID, Client Secret (minimal 8 karakter), dan Callback URL.");
                return;
              }
              save.mutate();
            }}
          >
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">Client ID GitHub</span>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                maxLength={300}
                placeholder="Client ID dari OAuth App GitHub"
                className={`${adminInputCls} w-full`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">Client Secret GitHub baru</span>
              <input
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                maxLength={400}
                autoComplete="off"
                placeholder="Masukkan Client Secret (disimpan terenkripsi, tidak pernah ditampilkan lagi)"
                className={`${adminInputCls} w-full`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">Callback URL</span>
              <input
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                maxLength={500}
                placeholder="https://dadiweb.id/"
                className={`${adminInputCls} w-full`}
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-[var(--dim-2)]">
                Harus persis sama dengan Authorization callback URL yang
                didaftarkan di OAuth App GitHub. Selama domain belum
                terdaftar, isi dengan URL yang akan dipakai nanti — login
                sungguhan tetap belum bisa dites sampai URL itu aktif.
              </span>
            </label>
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {save.isPending ? "Menyimpan…" : "Simpan Kredensial GitHub"}
            </button>
          </form>
          {s.configured && (
            <div className="mt-3">
              {!confirmClear ? (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/25"
                >
                  Hapus Kredensial GitHub
                </button>
              ) : (
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[13px] text-rose-200">
                  Hapus kredensial login GitHub? Tombol GitHub kembali
                  menampilkan pesan belum aktif.
                  <span className="ml-3 inline-flex gap-2">
                    <button
                      onClick={() => clear.mutate()}
                      disabled={clear.isPending}
                      className="font-bold underline underline-offset-2 disabled:opacity-60"
                    >
                      {clear.isPending ? "Menghapus…" : "Ya, hapus"}
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="font-bold underline underline-offset-2"
                    >
                      Batal
                    </button>
                  </span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// G10 — Panel Admin Cloudflare: settings DNS untuk deploy subdomain.
// Token disimpan terenkripsi AES-256-GCM, hanya 4 karakter terakhir yang
// tampil. PENTING: token yang pernah terkirim lewat chat JANGAN dipakai
// di sini — pakai token baru hasil rotasi, dipasang langsung lewat
// panel ini. Menyimpan settings bukan koneksi sungguhan: deploy dengan
// token dummy akan gagal bersih di tahap API Cloudflare.
// ---------------------------------------------------------------------------

export function CloudflarePanel({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin-cloudflare-settings", token],
    queryFn: () => api.getCloudflareSettings({ token }),
  });
  const s = settings.data;
  const [notice, setNotice] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [serverIp, setServerIp] = useState("");
  const [recordMode, setRecordMode] = useState<"dns_only" | "proxied">(
    "dns_only",
  );
  const [confirmClear, setConfirmClear] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin-cloudflare-settings"],
    });
  };

  const save = useMutation({
    mutationFn: () =>
      api.setCloudflareSettings({
        token,
        accountId: accountId.trim(),
        zoneId: zoneId.trim(),
        apiToken: apiToken.trim(),
        serverIp: serverIp.trim() || "82.25.62.243",
        recordMode,
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setAccountId("");
        setZoneId("");
        setApiToken("");
        setServerIp("");
        setNotice(
          `Settings Cloudflare tersimpan terenkripsi (zone ${res.zoneId}, IP ${res.serverIp}, mode ${res.recordMode === "proxied" ? "proxied" : "DNS-only"}, token ${res.tokenHint}). Deploy berikutnya akan membuat record DNS A via API Cloudflare.`,
        );
      } else {
        setNotice(res.error ?? "Gagal menyimpan settings Cloudflare.");
      }
      invalidate();
    },
    onError: (e) =>
      setNotice(
        e instanceof Error
          ? e.message
          : "Gagal menyimpan settings Cloudflare.",
      ),
  });

  const clear = useMutation({
    mutationFn: () => api.clearCloudflareSettings({ token }),
    onSuccess: (res) => {
      setConfirmClear(false);
      setNotice(
        res.ok
          ? "Settings Cloudflare dihapus. Deploy kembali gagal bersih sampai settings dilengkapi lagi."
          : (res.error ?? "Gagal menghapus settings Cloudflare."),
      );
      invalidate();
    },
    onError: (e) =>
      setNotice(
        e instanceof Error
          ? e.message
          : "Gagal menghapus settings Cloudflare.",
      ),
  });

  const missingLabel = (m: string) =>
    m === "accountId"
      ? "Account ID Cloudflare"
      : m === "zoneId"
        ? "Zone ID (zone dadiweb.id)"
        : m === "apiToken"
          ? "API Token Cloudflare"
          : "IP server";

  return (
    <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <h2 className="text-[15px] font-bold">Cloudflare (DNS Deploy) — G10</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Deploy proyek membuat record DNS A{" "}
        <span className="font-mono text-slate-200">{"{slug}.dadiweb.id"}</span>{" "}
        ke IP server lewat API Cloudflare, sebelum baris deployment
        ditandai live dan sebelum 25 kredit dipotong. Tanpa settings
        lengkap, atau bila API Cloudflare gagal, deploy gagal bersih:
        tidak live, tidak potong kredit. Token disimpan terenkripsi dan
        tidak pernah ditampilkan lagi — yang tampil hanya 4 karakter
        terakhirnya. Mode default DNS-only, sama seperti domain utama
        dadiweb.id saat ini; mode proxied memakai SSL tepi Cloudflare.
        Akses HTTPS subdomain sungguhan tetap menunggu vhost wildcard +
        SSL di staging.
      </p>
      {notice && (
        <p role="status" className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {settings.isPending ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Memuat settings Cloudflare…</p>
      ) : !s?.isAdmin ? (
        <p className="mt-3 text-sm text-[var(--dim)]">
          Settings Cloudflare hanya bisa dilihat dan diubah akun admin.
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">Status</span>
              {s.configured ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                  Terpasang — deploy akan membuat record DNS
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                  Belum lengkap — deploy gagal bersih sampai dilengkapi
                </span>
              )}
            </div>
            {s.configured && (
              <dl className="mt-3 space-y-1.5 text-[13px]">
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">Account ID:</dt>
                  <dd className="break-all font-mono text-xs">{s.accountId}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">Zone ID:</dt>
                  <dd className="break-all font-mono text-xs">{s.zoneId}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">IP server:</dt>
                  <dd className="font-mono text-xs">{s.serverIp}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">Mode record:</dt>
                  <dd className="font-mono text-xs">
                    {s.recordMode === "proxied" ? "proxied" : "DNS-only"}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-bold text-[var(--dim)]">API Token:</dt>
                  <dd className="font-mono text-xs">{s.tokenHint} (hanya petunjuk)</dd>
                </div>
              </dl>
            )}
            {!s.configured && s.missing.length > 0 && (
              <p className="mt-3 text-[13px] text-amber-200">
                Masih kurang: {s.missing.map(missingLabel).join(", ")}.
              </p>
            )}
          </div>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                accountId.trim() === "" ||
                zoneId.trim() === "" ||
                apiToken.trim().length < 8
              ) {
                setNotice(
                  "Lengkapi Account ID, Zone ID, dan API Token (minimal 8 karakter).",
                );
                return;
              }
              save.mutate();
            }}
          >
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">Account ID Cloudflare</span>
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                maxLength={300}
                placeholder="Account ID dari dashboard Cloudflare"
                className={`${adminInputCls} w-full`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">Zone ID (zone dadiweb.id)</span>
              <input
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                maxLength={300}
                placeholder="Zone ID zone dadiweb.id"
                className={`${adminInputCls} w-full`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">API Token Cloudflare baru</span>
              <input
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                maxLength={500}
                autoComplete="off"
                placeholder="Token baru hasil rotasi (disimpan terenkripsi, tidak pernah ditampilkan lagi)"
                className={`${adminInputCls} w-full`}
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-[var(--dim-2)]">
                Pakai token baru hasil rotasi — jangan pakai token yang
                pernah terkirim lewat chat. Token butuh izin DNS:Edit
                untuk zone dadiweb.id.
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">IP server (origin record A)</span>
              <input
                value={serverIp}
                onChange={(e) => setServerIp(e.target.value)}
                maxLength={100}
                placeholder="82.25.62.243"
                className={`${adminInputCls} w-full`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold">Mode record</span>
              <select
                value={recordMode}
                onChange={(e) =>
                  setRecordMode(
                    e.target.value === "proxied" ? "proxied" : "dns_only",
                  )
                }
                className={`${adminInputCls} w-full`}
              >
                <option value="dns_only">DNS-only (default — seperti domain utama)</option>
                <option value="proxied">Proxied (lewat Cloudflare)</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {save.isPending ? "Menyimpan…" : "Simpan Settings Cloudflare"}
            </button>
          </form>
          {s.configured && (
            <div className="mt-3">
              {!confirmClear ? (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/25"
                >
                  Hapus Settings Cloudflare
                </button>
              ) : (
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[13px] text-rose-200">
                  Hapus settings Cloudflare? Deploy kembali gagal bersih
                  sampai settings dilengkapi lagi.
                  <span className="ml-3 inline-flex gap-2">
                    <button
                      onClick={() => clear.mutate()}
                      disabled={clear.isPending}
                      className="font-bold underline underline-offset-2 disabled:opacity-60"
                    >
                      {clear.isPending ? "Menghapus…" : "Ya, hapus"}
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="font-bold underline underline-offset-2"
                    >
                      Batal
                    </button>
                  </span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// G5-C — Panel Admin lengkap: pengguna, proyek lintas pengguna, deployment
// global, kredit & tarif, invoice, integrasi, komunitas & moderasi,
// pengaturan platform, dan log audit admin. Semua aksi khusus admin;
// perubahan tarif/pengaturan berlaku untuk operasi berikutnya.
// ---------------------------------------------------------------------------

const adminInputCls =
  "rounded-lg border border-[var(--border)] bg-[#0A1130] px-2.5 py-1.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none";

// Bagian-bagian panel admin lengkap yang dirender satu per modul di
// halaman admin (/admin). Tanpa prop `section`, semua bagian tampil
// seperti sebelumnya.
export type AdminCompleteSection =
  | "pengguna"
  | "proyek"
  | "deployment"
  | "kredit"
  | "invoice"
  | "integrasi"
  | "komunitas"
  | "platform"
  | "audit";

export function AdminCompletePanel({
  token,
  section,
}: {
  token: string;
  section?: AdminCompleteSection;
}) {
  const showSection = (s: AdminCompleteSection) => section === undefined || section === s;
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const show = (msg: string) => setNotice(msg);
  const invalidateAll = () => {
    for (const key of [
      "admin-users",
      "admin-projects",
      "admin-deployments",
      "admin-tariffs",
      "admin-invoices",
      "admin-integrations",
      "admin-platform-settings",
      "admin-audit-log",
      "admin-stats",
      "community",
      "dadiweb-state",
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const usersQ = useQuery({ queryKey: ["admin-users", token], queryFn: () => api.adminListUsers({ token }) });
  const projectsQ = useQuery({ queryKey: ["admin-projects", token], queryFn: () => api.adminListProjects({ token }) });
  const deploymentsQ = useQuery({ queryKey: ["admin-deployments", token], queryFn: () => api.adminListDeployments({ token }) });
  const tariffsQ = useQuery({ queryKey: ["admin-tariffs", token], queryFn: () => api.adminGetTariffs({ token }) });
  const invoicesQ = useQuery({ queryKey: ["admin-invoices", token], queryFn: () => api.adminListInvoices({ token }) });
  const integrationsQ = useQuery({ queryKey: ["admin-integrations", token], queryFn: () => api.adminIntegrationStatus({ token }) });
  const settingsQ = useQuery({ queryKey: ["admin-platform-settings", token], queryFn: () => api.getPlatformSettings({ token }) });
  const communityQ = useQuery({ queryKey: ["community", token], queryFn: () => api.getCommunity({ token }) });

  const [auditAction, setAuditAction] = useState("");
  const [auditEmail, setAuditEmail] = useState("");
  const [auditStart, setAuditStart] = useState("");
  const [auditEnd, setAuditEnd] = useState("");
  const [auditApplied, setAuditApplied] = useState({ action: "", adminEmail: "", startDate: "", endDate: "" });
  const auditQ = useQuery({
    queryKey: ["admin-audit-log", token, auditApplied],
    queryFn: () =>
      api.getAdminAuditLog({
        token,
        action: auditApplied.action || undefined,
        adminEmail: auditApplied.adminEmail || undefined,
        startDate: auditApplied.startDate || undefined,
        endDate: auditApplied.endDate || undefined,
        limit: 100,
      }),
  });

  const [planInputs, setPlanInputs] = useState<Record<number, string>>({});
  const [adjustAmounts, setAdjustAmounts] = useState<Record<number, string>>({});
  const [adjustReasons, setAdjustReasons] = useState<Record<number, string>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<number | null>(null);
  const projectDetailQ = useQuery({
    queryKey: ["admin-project-detail", token, selectedProjectId],
    queryFn: () => api.adminGetProjectDetail({ token, projectId: selectedProjectId ?? 0 }),
    enabled: selectedProjectId !== null,
  });

  const [tariffGen, setTariffGen] = useState("");
  const [tariffDep, setTariffDep] = useState("");
  const [tariffAnd, setTariffAnd] = useState("");
  const tariffs = tariffsQ.data?.tariffs;
  const effGen = tariffGen !== "" ? tariffGen : tariffs ? String(tariffs.generate) : "";
  const effDep = tariffDep !== "" ? tariffDep : tariffs ? String(tariffs.deploy) : "";
  const effAnd = tariffAnd !== "" ? tariffAnd : tariffs ? String(tariffs.android) : "";

  const [platName, setPlatName] = useState("");
  const [platMsg, setPlatMsg] = useState("");
  const [platMaint, setPlatMaint] = useState<boolean | null>(null);
  const [platFree, setPlatFree] = useState("");
  const settings = settingsQ.data?.settings;
  const effPlatName = platName !== "" ? platName : (settings?.platformName ?? "");
  const effPlatMsg = platMsg !== "" ? platMsg : (settings?.maintenanceMessage ?? "");
  const effPlatMaint = platMaint !== null ? platMaint : (settings?.maintenanceEnabled ?? false);
  const effPlatFree = platFree !== "" ? platFree : settings ? String(settings.freeQuota) : "";

  const setPlan = useMutation({
    mutationFn: (args: { userId: number; plan: "Free" | "Pro" | "Pro Plan" | "Bisnis" }) => api.adminSetUserPlan({ token, ...args }),
    onSuccess: (res) => {
      show(res.ok ? `Paket pengguna diubah menjadi ${res.plan} (sebelumnya ${res.previousPlan}). Saldo tidak berubah; kuota baru berlaku ke depan.` : (res.error ?? "Gagal mengubah paket."));
      invalidateAll();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Gagal mengubah paket."),
  });
  const setActive = useMutation({
    mutationFn: (args: { userId: number; isActive: boolean }) => api.adminSetUserActive({ token, ...args }),
    onSuccess: (res) => {
      show(res.ok ? `Akun sekarang ${res.isActive ? "AKTIF" : "NONAKTIF — tidak bisa login dan generate, datanya tetap tersimpan"}.` : (res.error ?? "Gagal mengubah status akun."));
      invalidateAll();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Gagal mengubah status akun."),
  });
  const adjust = useMutation({
    mutationFn: (args: { userId: number; amount: number; reason: string }) => api.adminAdjustCredits({ token, ...args }),
    onSuccess: (res, vars) => {
      show(res.ok ? `Penyesuaian saldo tercatat di buku besar pengguna (saldo sekarang ${fmtNum(res.balance)} kredit) beserta alasan dan admin pelaksananya.` : (res.error ?? "Gagal menyesuaikan saldo."));
      if (res.ok) {
        setAdjustAmounts((m) => ({ ...m, [vars.userId]: "" }));
        setAdjustReasons((m) => ({ ...m, [vars.userId]: "" }));
      }
      invalidateAll();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Gagal menyesuaikan saldo."),
  });
  const deleteProject = useMutation({
    mutationFn: (projectId: number) => api.adminDeleteProject({ token, projectId }),
    onSuccess: (res) => {
      setConfirmDeleteProjectId(null);
      show(res.ok ? `Proyek "${res.projectName}" dihapus paksa oleh admin lewat jalur transaksi tercatat; riwayat kredit pemilik dipertahankan.` : (res.error ?? "Gagal menghapus proyek."));
      invalidateAll();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Gagal menghapus proyek."),
  });
  const rollback = useMutation({
    mutationFn: (deploymentId: number) => api.adminRollbackDeployment({ token, deploymentId }),
    onSuccess: (res) => {
      show(res.ok ? `Rollback berhasil — deployment baru #${res.deploymentId} sekarang live.` : (res.error ?? "Gagal rollback deployment."));
      invalidateAll();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Gagal rollback deployment."),
  });
  const saveTariffs = useMutation({
    mutationFn: () =>
      api.adminSetTariffs({ token, generateCost: Number(effGen), deployCost: Number(effDep), androidCost: Number(effAnd) }),
    onSuccess: (res) => {
      show(res.ok ? `Tarif diperbarui: generate ${res.tariffs.generate}, deploy ${res.tariffs.deploy}, build Android ${res.tariffs.android}. Berlaku untuk generate/deploy/build berikutnya, bukan retroaktif.` : (res.error ?? "Gagal mengubah tarif."));
      setTariffGen(""); setTariffDep(""); setTariffAnd("");
      invalidateAll();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Gagal mengubah tarif."),
  });
  const saveSettings = useMutation({
    mutationFn: () =>
      api.updatePlatformSettings({
        token,
        platformName: effPlatName.trim(),
        maintenanceMessage: effPlatMsg,
        maintenanceEnabled: effPlatMaint,
        freeQuota: Number(effPlatFree),
      }),
    onSuccess: (res) => {
      show(res.ok ? "Pengaturan platform tersimpan. Kuota Free baru hanya berlaku untuk pendaftar baru; pesan maintenance tampil untuk pengguna non-admin." : (res.error ?? "Gagal menyimpan pengaturan platform."));
      setPlatName(""); setPlatMsg(""); setPlatFree(""); setPlatMaint(null);
      invalidateAll();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Gagal menyimpan pengaturan platform."),
  });
  const hidePost = useMutation({
    mutationFn: (args: { postId: number; hidden: boolean }) => api.adminHideCommunityPost({ token, ...args }),
    onSuccess: (res) => {
      show(res.ok ? `Postingan sekarang ${res.hidden ? "TERSEMBUNYI dari pengguna biasa" : "tampil kembali"}.` : (res.error ?? "Gagal mengubah visibilitas postingan."));
      invalidateAll();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Gagal mengubah visibilitas postingan."),
  });
  const deletePost = useMutation({
    mutationFn: (postId: number) => api.adminDeleteCommunityPost({ token, postId }),
    onSuccess: (res) => {
      show(res.ok ? "Postingan komunitas dihapus beserta komentar dan sukanya." : (res.error ?? "Gagal menghapus postingan."));
      invalidateAll();
    },
    onError: (e) => show(e instanceof Error ? e.message : "Gagal menghapus postingan."),
  });

  const sectionCls = "mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5";
  return (
    <>
      {notice && (
        <p role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {showSection("pengguna") && (
      <section className={sectionCls} aria-label="Pengguna semua akun">
        <h2 className="text-[15px] font-bold">Pengguna — Semua Akun</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Ubah paket (saldo tidak berubah, hanya kuota ke depan), nonaktifkan/aktifkan akun
          (akun nonaktif tidak bisa login dan generate, datanya tidak dihapus), dan sesuaikan
          saldo secara manual dengan alasan wajib — setiap penyesuaian tercatat di buku besar
          pengguna dan di log audit admin.
        </p>
        {usersQ.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Memuat pengguna…</p>
        ) : !usersQ.data?.isAdmin ? (
          <p className="mt-3 text-sm text-[var(--dim)]">{usersQ.data?.error ?? "Hanya admin yang dapat melihat daftar pengguna."}</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border-soft)]">
            {usersQ.data.users.map((u) => (
              <li key={u.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{u.name}</span>
                  <span className="text-[var(--dim)]">{u.email}</span>
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-[var(--dim)]">{u.plan}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${u.isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-300"}`}>
                    {u.isActive ? "Aktif" : "Nonaktif"}
                  </span>
                  <span className="text-[var(--dim)] tnum">Saldo {fmtNum(u.balance)} / {fmtNum(u.monthlyQuota)} · {u.projectCount} proyek · bergabung {timeAgo(u.createdAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-[var(--dim)]">
                    Paket
                    <select
                      aria-label={`Paket untuk ${u.email}`}
                      value={planInputs[u.id] ?? u.plan}
                      onChange={(e) => setPlanInputs({ ...planInputs, [u.id]: e.target.value })}
                      className="rounded-lg border border-[var(--border)] bg-[#0A1130] px-2.5 py-1.5 text-sm font-semibold text-white focus:outline-none"
                    >
                      <option value="Free">Free</option>
                      <option value="Pro Plan">Pro</option>
                      <option value="Bisnis">Bisnis</option>
                    </select>
                  </label>
                  <button
                    onClick={() => setPlan.mutate({ userId: u.id, plan: (planInputs[u.id] ?? u.plan) as "Free" | "Pro Plan" | "Bisnis" })}
                    disabled={setPlan.isPending}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white hover:brightness-110 disabled:opacity-60"
                  >
                    Simpan Paket {u.name}
                  </button>
                  <button
                    onClick={() => setActive.mutate({ userId: u.id, isActive: !u.isActive })}
                    disabled={setActive.isPending}
                    aria-label={`${u.isActive ? "Nonaktifkan" : "Aktifkan"} akun ${u.email}`}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-60 ${u.isActive ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25" : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"}`}
                  >
                    {u.isActive ? "Nonaktifkan Akun" : "Aktifkan Akun"}
                  </button>
                </div>
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const amount = Number(adjustAmounts[u.id] ?? "");
                    const reason = (adjustReasons[u.id] ?? "").trim();
                    if (!Number.isFinite(amount) || amount === 0) { show("Jumlah penyesuaian harus angka selain nol."); return; }
                    if (reason.length < 3) { show("Alasan penyesuaian wajib diisi (minimal 3 karakter)."); return; }
                    adjust.mutate({ userId: u.id, amount: Math.trunc(amount), reason });
                  }}
                >
                  <label className="flex items-center gap-2 text-xs font-semibold text-[var(--dim)]">
                    Penyesuaian saldo (+/−)
                    <input
                      type="number"
                      step="1"
                      value={adjustAmounts[u.id] ?? ""}
                      onChange={(e) => setAdjustAmounts({ ...adjustAmounts, [u.id]: e.target.value })}
                      placeholder="cth. 100 atau -50"
                      aria-label={`Jumlah penyesuaian saldo untuk ${u.email}`}
                      className={`${adminInputCls} w-32 tnum`}
                    />
                  </label>
                  <label className="flex min-w-[200px] flex-1 items-center gap-2 text-xs font-semibold text-[var(--dim)]">
                    Alasan (wajib)
                    <input
                      value={adjustReasons[u.id] ?? ""}
                      onChange={(e) => setAdjustReasons({ ...adjustReasons, [u.id]: e.target.value })}
                      placeholder="cth. Kompensasi gangguan layanan"
                      aria-label={`Alasan penyesuaian saldo untuk ${u.email}`}
                      className={`${adminInputCls} min-w-0 flex-1`}
                    />
                  </label>
                  <button type="submit" disabled={adjust.isPending} className="rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12 disabled:opacity-60">
                    Terapkan Penyesuaian
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {showSection("proyek") && (
      <section className={sectionCls} aria-label="Proyek lintas pengguna">
        <h2 className="text-[15px] font-bold">Proyek — Lintas Pengguna</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Semua proyek semua pengguna. Detail menampilkan isolasi G2 proyek itu (skema
          proj_&lt;id&gt; dan status kredensial proyeknya). Hapus paksa memakai jalur
          transaksi tercatat yang sama seperti hapus oleh pemilik.
        </p>
        {projectsQ.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Memuat proyek…</p>
        ) : !projectsQ.data?.isAdmin ? (
          <p className="mt-3 text-sm text-[var(--dim)]">{projectsQ.data?.error ?? "Hanya admin yang dapat melihat proyek semua pengguna."}</p>
        ) : projectsQ.data.projects.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Belum ada proyek di platform.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border-soft)]">
            {projectsQ.data.projects.map((pr) => (
              <li key={pr.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">#{pr.id} {pr.name}</span>
                  <span className="text-[var(--dim)]">milik {pr.ownerName} ({pr.ownerEmail}) · {pr.status} · deploy: {pr.deploymentStatus}{pr.subdomain ? ` · ${pr.subdomain}` : ""} · dibuat {timeAgo(pr.createdAt)}</span>
                  <span className="ml-auto flex gap-2">
                    <button
                      onClick={() => setSelectedProjectId(pr.id)}
                      aria-label={`Lihat detail proyek ${pr.name}`}
                      className="rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12"
                    >
                      Detail &amp; Isolasi
                    </button>
                    <button
                      onClick={() => setConfirmDeleteProjectId(pr.id)}
                      aria-label={`Hapus paksa proyek ${pr.name}`}
                      className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
                    >
                      Hapus Paksa
                    </button>
                  </span>
                </div>
                {confirmDeleteProjectId === pr.id && (
                  <p className="mt-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[13px] text-rose-200">
                    Hapus paksa proyek <strong>{pr.name}</strong> milik {pr.ownerEmail}? Folder, skema, dan artefak build dihapus; riwayat kredit dipertahankan dan tercatat di log penghapusan.
                    <span className="ml-3 inline-flex gap-2">
                      <button onClick={() => deleteProject.mutate(pr.id)} disabled={deleteProject.isPending} className="font-bold underline underline-offset-2 disabled:opacity-60">
                        {deleteProject.isPending ? "Menghapus…" : "Ya, hapus paksa"}
                      </button>
                      <button onClick={() => setConfirmDeleteProjectId(null)} className="font-bold underline underline-offset-2">Batal</button>
                    </span>
                  </p>
                )}
                {selectedProjectId === pr.id && (
                  <div className="mt-2 rounded-xl bg-white/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-300">
                    {projectDetailQ.isPending ? (
                      "Memuat detail proyek…"
                    ) : projectDetailQ.data?.found ? (
                      <>
                        <p><strong className="text-white">Isolasi G2:</strong> skema {projectDetailQ.data.isolation?.schemaName} · pengguna DB {projectDetailQ.data.isolation?.dbUsername} · {projectDetailQ.data.isolation?.credentialStatus} · kredensial platform terekspos: {projectDetailQ.data.isolation?.platformCredentialExposed ? "ya" : "tidak"}</p>
                        <p className="mt-1">Tabel ({projectDetailQ.data.tables.length}): {projectDetailQ.data.tables.map((t) => `${t.name} di ${t.schemaName} (${t.rowCount} baris)`).join("; ") || "tidak ada"}</p>
                        <p className="mt-1">Deployment ({projectDetailQ.data.deployments.length}): {projectDetailQ.data.deployments.map((d) => `#${d.id} ${d.subdomain} — ${d.status}`).join("; ") || "belum ada"}</p>
                        <button onClick={() => setSelectedProjectId(null)} className="mt-1 font-bold text-[#6EA8FF] underline underline-offset-2">Tutup detail</button>
                      </>
                    ) : (
                      projectDetailQ.data?.error ?? "Detail proyek tidak ditemukan."
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {showSection("deployment") && (
      <section className={sectionCls} aria-label="Deployment global">
        <h2 className="text-[15px] font-bold">Deployment — Global</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Riwayat deployment semua pengguna. Rollback paksa menerbitkan ulang versi lama
          sebagai versi live baru (logika yang sama seperti rollback pemilik).
        </p>
        {deploymentsQ.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Memuat deployment…</p>
        ) : !deploymentsQ.data?.isAdmin ? (
          <p className="mt-3 text-sm text-[var(--dim)]">{deploymentsQ.data?.error ?? "Hanya admin yang dapat melihat deployment global."}</p>
        ) : deploymentsQ.data.deployments.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Belum ada deployment di platform.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border-soft)]">
            {deploymentsQ.data.deployments.slice(0, 30).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <span className="font-bold">#{d.id} {d.subdomain}</span>
                <span className="text-[var(--dim)]">proyek {d.projectName} · milik {d.ownerEmail} · {d.kind} · {timeAgo(d.createdAt)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${d.status === "live" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/8 text-[var(--dim)]"}`}>{d.status === "live" ? "Live" : "Digantikan"}</span>
                {d.status !== "live" && (
                  <button
                    onClick={() => rollback.mutate(d.id)}
                    disabled={rollback.isPending}
                    aria-label={`Rollback paksa deployment ${d.id} ${d.subdomain}`}
                    className="ml-auto rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12 disabled:opacity-60"
                  >
                    Rollback ke Versi Ini
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {showSection("kredit") && (
      <section className={sectionCls} aria-label="Kredit dan langganan tarif">
        <h2 className="text-[15px] font-bold">Kredit &amp; Langganan — Tarif Platform</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Tarif saat ini tampil apa adanya. Mengubah tarif berlaku untuk generate, deploy,
          dan build Android BERIKUTNYA — tidak retroaktif — dan tercatat di log audit
          dengan nilai sebelum/sesudah. Penyesuaian saldo manual ada di daftar Pengguna di atas.
        </p>
        {tariffsQ.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Memuat tarif…</p>
        ) : !tariffsQ.data?.isAdmin ? (
          <p className="mt-3 text-sm text-[var(--dim)]">{tariffsQ.data?.error ?? "Hanya admin yang dapat melihat tarif."}</p>
        ) : (
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const vals = [effGen, effDep, effAnd].map(Number);
              if (vals.some((v) => !Number.isFinite(v) || v < 0 || !Number.isInteger(v))) { show("Tarif harus bilangan bulat 0 atau lebih."); return; }
              saveTariffs.mutate();
            }}
          >
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Tarif generate (kredit)
              <input type="number" min={0} step="1" value={effGen} onChange={(e) => setTariffGen(e.target.value)} aria-label="Tarif generate dalam kredit" className={`${adminInputCls} mt-1 w-32 tnum`} />
            </label>
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Tarif deploy (kredit)
              <input type="number" min={0} step="1" value={effDep} onChange={(e) => setTariffDep(e.target.value)} aria-label="Tarif deploy dalam kredit" className={`${adminInputCls} mt-1 w-32 tnum`} />
            </label>
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Tarif build Android (kredit)
              <input type="number" min={0} step="1" value={effAnd} onChange={(e) => setTariffAnd(e.target.value)} aria-label="Tarif build Android dalam kredit" className={`${adminInputCls} mt-1 w-32 tnum`} />
            </label>
            <button type="submit" disabled={saveTariffs.isPending} className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-white hover:brightness-110 disabled:opacity-60">
              {saveTariffs.isPending ? "Menyimpan…" : "Simpan Tarif"}
            </button>
          </form>
        )}
      </section>
      )}

      {showSection("invoice") && (
      <section className={sectionCls} aria-label="Invoice dan pembayaran">
        <h2 className="text-[15px] font-bold">Invoice &amp; Pembayaran</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Semua invoice semua pengguna. {invoicesQ.data?.paymentNote ?? "Pembayaran lewat DOKU masih simulasi di prototipe."}
        </p>
        {invoicesQ.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Memuat invoice…</p>
        ) : !invoicesQ.data?.isAdmin ? (
          <p className="mt-3 text-sm text-[var(--dim)]">{invoicesQ.data?.error ?? "Hanya admin yang dapat melihat invoice."}</p>
        ) : invoicesQ.data.invoices.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Belum ada invoice di platform.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border-soft)]">
            {invoicesQ.data.invoices.slice(0, 30).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <span className="font-mono font-bold">{i.number || `#${i.id}`}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--dim)]">{i.title} · {i.userName} ({i.userEmail}) · {timeAgo(i.createdAt)}</span>
                <span className="tnum font-bold">{i.amountIdr !== null ? `Rp${fmtNum(i.amountIdr)}` : `${i.creditsDelta > 0 ? "+" : ""}${fmtNum(i.creditsDelta)} kredit`}</span>
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-bold text-[var(--dim)]">{i.status} · DOKU {i.dokuStatus}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {showSection("integrasi") && (
      <section className={sectionCls} aria-label="Status integrasi">
        <h2 className="text-[15px] font-bold">Integrasi — Status Kredensial Go-Live</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Status jujur setiap kredensial go-live. Nilai secret tidak pernah ditampilkan —
          hanya status terpasang, belum terpasang, atau simulasi.
        </p>
        {integrationsQ.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Memuat status integrasi…</p>
        ) : !integrationsQ.data?.isAdmin ? (
          <p className="mt-3 text-sm text-[var(--dim)]">{integrationsQ.data?.error ?? "Hanya admin yang dapat melihat status integrasi."}</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border-soft)]">
            {integrationsQ.data.integrations.map((g) => (
              <li key={g.key} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{g.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${g.status === "terpasang" ? "bg-emerald-500/15 text-emerald-400" : g.status === "simulasi" ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300"}`}>
                    {g.statusLabel}
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--dim)]">{g.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {showSection("komunitas") && (
      <section className={sectionCls} aria-label="Komunitas dan moderasi">
        <h2 className="text-[15px] font-bold">Komunitas &amp; Moderasi</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Daftar posting memakai data komunitas yang sama seperti halaman Komunitas.
          Sembunyikan menyembunyikan posting dari pengguna biasa (admin tetap melihatnya);
          hapus menghapus posting beserta komentar dan sukanya. Keduanya tercatat di log audit.
        </p>
        {communityQ.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Memuat postingan…</p>
        ) : (communityQ.data?.posts ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Belum ada postingan komunitas.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border-soft)]">
            {(communityQ.data?.posts ?? []).map((post) => (
              <li key={post.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{post.title}</span>
                  {post.hidden && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">Tersembunyi</span>}
                  <span className="text-[var(--dim)]">oleh {post.authorName} · {post.tag} · {timeAgo(post.createdAt)}</span>
                  <span className="ml-auto flex gap-2">
                    <button
                      onClick={() => hidePost.mutate({ postId: post.id, hidden: !post.hidden })}
                      disabled={hidePost.isPending}
                      aria-label={`${post.hidden ? "Tampilkan kembali" : "Sembunyikan"} postingan ${post.title}`}
                      className="rounded-lg bg-white/8 px-3 py-1.5 text-xs font-bold hover:bg-white/12 disabled:opacity-60"
                    >
                      {post.hidden ? "Tampilkan Kembali" : "Sembunyikan"}
                    </button>
                    <button
                      onClick={() => deletePost.mutate(post.id)}
                      disabled={deletePost.isPending}
                      aria-label={`Hapus postingan ${post.title}`}
                      className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-60"
                    >
                      Hapus Postingan
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {showSection("platform") && (
      <section className={sectionCls} aria-label="Pengaturan platform">
        <h2 className="text-[15px] font-bold">Pengaturan Platform</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Nama platform, pesan maintenance (tampil sebagai banner untuk pengguna non-admin
          tanpa memblokir panel Admin), dan kuota default akun Free — kuota baru hanya
          berlaku untuk pendaftar baru, tidak mengubah kuota pengguna yang sudah ada.
          Tarif yang sedang berlaku: generate {settings?.tariffs.generate ?? "—"}, deploy{" "}
          {settings?.tariffs.deploy ?? "—"}, build Android {settings?.tariffs.android ?? "—"}.
        </p>
        {settingsQ.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Memuat pengaturan…</p>
        ) : !settingsQ.data?.isAdmin ? (
          <p className="mt-3 text-sm text-[var(--dim)]">{settingsQ.data?.error ?? "Hanya admin yang dapat melihat pengaturan platform."}</p>
        ) : (
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!effPlatName.trim()) { show("Nama platform tidak boleh kosong."); return; }
              const fq = Number(effPlatFree);
              if (!Number.isFinite(fq) || fq < 0 || !Number.isInteger(fq)) { show("Kuota default Free harus bilangan bulat 0 atau lebih."); return; }
              saveSettings.mutate();
            }}
          >
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Nama platform
              <input value={effPlatName} onChange={(e) => setPlatName(e.target.value)} aria-label="Nama platform" className={`${adminInputCls} mt-1 w-full`} />
            </label>
            <label className="block text-xs font-semibold text-[var(--dim)]">
              Kuota default Free (kredit, pendaftar baru)
              <input type="number" min={0} step="1" value={effPlatFree} onChange={(e) => setPlatFree(e.target.value)} aria-label="Kuota default akun Free" className={`${adminInputCls} mt-1 w-full tnum`} />
            </label>
            <label className="block text-xs font-semibold text-[var(--dim)] sm:col-span-2">
              Pesan maintenance
              <textarea value={effPlatMsg} onChange={(e) => setPlatMsg(e.target.value)} rows={2} maxLength={500} placeholder="cth. Pemeliharaan terjadwal malam ini pukul 23.00–00.00 WIB." aria-label="Pesan maintenance" className={`${adminInputCls} mt-1 w-full resize-none`} />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={effPlatMaint}
                onChange={(e) => setPlatMaint(e.target.checked)}
                aria-label="Aktifkan pesan maintenance"
                className="h-4 w-4 accent-[#2E6BFF]"
              />
              Aktifkan pesan maintenance untuk pengguna
            </label>
            <div>
              <button type="submit" disabled={saveSettings.isPending} className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-white hover:brightness-110 disabled:opacity-60">
                {saveSettings.isPending ? "Menyimpan…" : "Simpan Pengaturan Platform"}
              </button>
            </div>
          </form>
        )}
      </section>
      )}

      {showSection("audit") && (
      <section className={sectionCls} aria-label="Log audit admin">
        <h2 className="text-[15px] font-bold">Log Audit Admin</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Catatan append-only setiap aksi admin (termasuk aksi lama: hapus pengguna, status
          dan skor eval skill, registry model AI, kunci DeepInfra). Log ini tidak bisa diubah
          atau dihapus lewat aksi apa pun.
        </p>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setAuditApplied({ action: auditAction.trim(), adminEmail: auditEmail.trim(), startDate: auditStart, endDate: auditEnd });
          }}
        >
          <label className="block text-xs font-semibold text-[var(--dim)]">
            Filter aksi
            <input value={auditAction} onChange={(e) => setAuditAction(e.target.value)} placeholder="cth. adminSetTariffs" aria-label="Filter log audit berdasarkan aksi" className={`${adminInputCls} mt-1 w-44`} />
          </label>
          <label className="block text-xs font-semibold text-[var(--dim)]">
            Email admin
            <input value={auditEmail} onChange={(e) => setAuditEmail(e.target.value)} placeholder="cth. budi@email.com" aria-label="Filter log audit berdasarkan email admin" className={`${adminInputCls} mt-1 w-44`} />
          </label>
          <label className="block text-xs font-semibold text-[var(--dim)]">
            Tanggal mulai
            <input type="date" value={auditStart} onChange={(e) => setAuditStart(e.target.value)} aria-label="Filter log audit tanggal mulai" className={`${adminInputCls} mt-1`} />
          </label>
          <label className="block text-xs font-semibold text-[var(--dim)]">
            Tanggal akhir
            <input type="date" value={auditEnd} onChange={(e) => setAuditEnd(e.target.value)} aria-label="Filter log audit tanggal akhir" className={`${adminInputCls} mt-1`} />
          </label>
          <button type="submit" className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-white hover:brightness-110">
            Terapkan Filter Log
          </button>
        </form>
        {auditQ.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Memuat log audit…</p>
        ) : !auditQ.data?.isAdmin ? (
          <p className="mt-3 text-sm text-[var(--dim)]">{auditQ.data?.error ?? "Hanya admin yang dapat melihat log audit."}</p>
        ) : auditQ.data.entries.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Belum ada entri log audit yang cocok (total cocok: {auditQ.data.total}). Lakukan satu aksi admin di panel ini untuk melihat catatannya di sini.</p>
        ) : (
          <>
            <p className="mt-3 text-[13px] text-[var(--dim)]">Total entri cocok: <strong className="tnum text-slate-200">{auditQ.data.total}</strong> (terbaru dulu)</p>
            <ul className="mt-2 divide-y divide-[var(--border-soft)]">
              {auditQ.data.entries.map((en) => (
                <li key={en.id} className="py-2 text-[13px]">
                  <span className="font-mono font-bold">{en.action}</span>{" "}
                  <span className="text-[var(--dim)]">· target: {en.target} · oleh {en.adminEmail} · {timeAgo(en.createdAt)}</span>
                  <span className="block text-slate-300">Sebelum: {en.beforeValue || "—"}</span>
                  <span className="block text-slate-300">Sesudah: {en.afterValue || "—"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      )}
    </>
  );
}

// Modul "Ringkasan" halaman admin (/admin): statistik platform, pengguna
// terbaru, dan aktivitas buku besar terakhir. Panel-panel admin lain
// (katalog skill, model AI, panel lengkap) kini modul terpisah di halaman
// admin — tidak lagi tertanam di sini.
export function AdminSummary({ state, token }: { state: State; token: string }) {
  const queryClient = useQueryClient();
  const platform = useQuery({
    queryKey: ["admin-stats", token],
    queryFn: () => api.getAdminStats({ token }),
  });
  // G5-C — ringkasan panel admin juga memuat total biaya AI dari
  // pemakaian yang sudah tercatat (data yang sama seperti panel Model AI).
  const aiSummary = useQuery({
    queryKey: ["admin-ai-settings", token],
    queryFn: () => api.getAiProviderSettings({ token }),
  });
  const p = platform.data;
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const deleteUser = useMutation({
    mutationFn: (email: string) => api.adminDeleteUser({ token, email }),
    onSuccess: (res) => {
      setConfirmDeleteEmail(null);
      if (res.ok) {
        setAdminNotice(
          `Akun ${res.deletedEmail} beserta seluruh datanya sudah dihapus dari prototipe.`,
        );
        void queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
        void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
      } else {
        setAdminNotice(res.error ?? "Gagal menghapus akun.");
      }
    },
    onError: (e) =>
      setAdminNotice(e instanceof Error ? e.message : "Gagal menghapus akun."),
  });
  const totalUsed = state.usage.reduce((s, u) => s + u.used, 0);
  const stats = p?.isAdmin
    ? [
        { label: "Total Pengguna", value: fmtNum(p.totalUsers), icon: "users", color: "#2E6BFF" },
        { label: "Total Proyek (Semua Pengguna)", value: fmtNum(p.totalProjects), icon: "folder", color: "#7C4DFF" },
        { label: "Total Deploy", value: fmtNum(p.totalDeployments), icon: "rocket", color: "#F97316" },
        { label: "Kredit Terpakai (Platform)", value: fmtNum(p.creditsUsed), icon: "bolt", color: "#F59E0B" },
        { label: "Kredit Diberikan (Platform)", value: fmtNum(p.creditsGranted), icon: "card", color: "#2DD4BF" },
        { label: "Postingan Komunitas", value: fmtNum(p.totalCommunityPosts), icon: "chat", color: "#22C55E" },
        { label: "Total Biaya AI (USD)", value: aiSummary.data?.isAdmin ? `$${aiSummary.data.usageTotals.totalCostUsd.toFixed(4)}` : "$0", icon: "bolt", color: "#F43F5E" },
        { label: "Panggilan AI Tercatat", value: aiSummary.data?.isAdmin ? fmtNum(aiSummary.data.usageTotals.totalCalls) : "0", icon: "spark", color: "#2E6BFF" },
      ]
    : [
        { label: "Total Proyek", value: fmtNum(state.projects.length), icon: "folder", color: "#2E6BFF" },
        { label: "Proyek Online", value: fmtNum(state.projects.filter((x) => x.status === "online").length), icon: "globe", color: "#22C55E" },
        { label: "Total Deploy", value: fmtNum(state.deployments.length), icon: "rocket", color: "#F97316" },
        { label: "Kredit Terpakai", value: fmtNum(totalUsed), icon: "bolt", color: "#F59E0B" },
        { label: "Build Android", value: fmtNum(state.androidBuilds.length), icon: "phone", color: "#7C4DFF" },
        { label: "Saldo Kredit Akun Ini", value: fmtNum(state.account.balance), icon: "card", color: "#2DD4BF" },
      ];
  return (
    <div>
      <span className="inline-block rounded-full bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-400">
        Khusus Admin
      </span>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Ringkasan Platform</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--dim)]">
        {platform.isPending
          ? "Memuat statistik…"
          : p?.isAdmin
            ? "Kamu masuk sebagai akun pemilik (demo Budi Santoso), jadi panel ini menampilkan agregat seluruh platform: pengguna, proyek, deploy, dan peredaran kredit dari buku besar."
            : "Akunmu bukan akun pemilik platform, jadi panel ini hanya menampilkan statistik workspace milikmu sendiri — agregat lintas pengguna hanya bisa dilihat akun admin."}
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <article
            key={s.label}
            className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5"
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: `${s.color}22`, color: s.color }}
            >
              <Icon name={s.icon} size={19} />
            </span>
            <p className="mt-3 text-3xl font-extrabold tnum">{s.value}</p>
            <p className="mt-0.5 text-sm text-[var(--dim)]">{s.label}</p>
          </article>
        ))}
      </div>
      {adminNotice && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        >
          {adminNotice}
        </p>
      )}
      {p?.isAdmin && p.recentUsers.length > 0 && (
        <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <h2 className="text-[15px] font-bold">Pengguna Terbaru</h2>
          <ul className="mt-3 divide-y divide-[var(--border-soft)]">
            {p.recentUsers.map((u) => (
              <li key={u.email} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#2E6BFF] to-[#7C4DFF] text-xs font-extrabold text-white">
                    {u.name.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{u.name}</span>
                    <span className="block truncate text-xs text-[var(--dim)]">
                      {u.email} · via {u.provider} · bergabung {timeAgo(u.createdAt)}
                    </span>
                  </span>
                  <span className="rounded-full bg-white/8 px-2.5 py-0.5 text-[11px] font-bold text-[var(--dim)]">
                    {u.plan}
                  </span>
                  {u.email !== state.workspace.email && (
                    <button
                      onClick={() => setConfirmDeleteEmail(u.email)}
                      aria-label={`Hapus akun ${u.email} beserta datanya`}
                      className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
                    >
                      Hapus Akun
                    </button>
                  )}
                </div>
                {confirmDeleteEmail === u.email && (
                  <p className="mt-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[13px] text-rose-200">
                    Hapus akun <strong>{u.email}</strong> beserta seluruh
                    proyek, kredit, domain, build, postingan, dan invoicenya?
                    Tindakan ini tidak bisa dibatalkan.
                    <span className="ml-3 inline-flex gap-2">
                      <button
                        onClick={() => deleteUser.mutate(u.email)}
                        disabled={deleteUser.isPending}
                        className="font-bold underline underline-offset-2 disabled:opacity-60"
                      >
                        {deleteUser.isPending ? "Menghapus…" : "Ya, hapus permanen"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteEmail(null)}
                        className="font-bold underline underline-offset-2"
                      >
                        Batal
                      </button>
                    </span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <h2 className="text-[15px] font-bold">Aktivitas Terakhir (Buku Besar Kredit)</h2>
        {state.ledger.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--dim)]">
            Belum ada aktivitas tercatat di sesi prototipe ini.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border-soft)]">
            {state.ledger.slice(0, 8).map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{l.label}</span>
                <span className={`tnum font-bold ${l.amount < 0 ? "" : "text-emerald-400"}`}>
                  {l.amount > 0 ? "+" : "−"}
                  {fmtNum(Math.abs(l.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
