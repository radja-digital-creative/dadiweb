import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { Icon, Logo, timeAgo } from "./lib";
import heroImg from "./assets/hero.webp";

// Kotak masuk simulasi: pengganti pengiriman email sungguhan di prototipe.
// Pesan verifikasi email & reset kata sandi (berikut token sekali pakainya)
// diterbitkan server ke sini agar alurnya bisa dijalankan end-to-end,
// sampai layanan email produksi dipasang.
export function SimulatedInbox({
  email,
  purpose,
  onUseToken,
  actionLabel,
}: {
  email: string;
  purpose: "reset_password" | "verify_email";
  onUseToken: (token: string) => void;
  actionLabel: string;
}) {
  const queryClient = useQueryClient();
  const inbox = useQuery({
    queryKey: ["simulated-inbox", email, purpose],
    queryFn: () => api.getSimulatedInbox({ email: email.trim() }),
    enabled: email.trim().length > 3 && email.includes("@"),
  });
  const messages = (inbox.data?.messages ?? []).filter(
    (m) => m.purpose === purpose,
  );
  return (
    <section className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold text-sky-200">
          Kotak Masuk Simulasi — {email || "…"}
        </h3>
        <button
          type="button"
          onClick={() =>
            void queryClient.invalidateQueries({
              queryKey: ["simulated-inbox"],
            })
          }
          className="rounded-lg bg-white/8 px-2 py-1 text-[11px] font-bold text-sky-100 hover:bg-white/12"
        >
          Muat Ulang
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        Simulasi: di prototipe ini tidak ada email sungguhan yang dikirim.
        Pesan yang biasanya sampai ke emailmu muncul di sini; nanti di
        produksi, token yang sama dikirim lewat layanan email asli.
      </p>
      {inbox.isPending ? (
        <p className="mt-3 text-sm text-[var(--dim)]">Memuat pesan…</p>
      ) : messages.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--dim)]">
          Belum ada pesan untuk keperluan ini. Minta token dulu lewat tombol
          di atas, lalu muat ulang kotak masuk.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className="rounded-xl border border-[var(--border-soft)] bg-[#0A1130] p-3.5"
            >
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-bold">
                {m.subject}
                <span className="text-[11px] font-medium text-[var(--dim)]">
                  {timeAgo(m.createdAt)}
                </span>
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
                {m.body}
              </p>
              <p className="mt-2 overflow-x-auto rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-xs text-slate-200">
                Token: {m.token}
              </p>
              <button
                type="button"
                onClick={() => onUseToken(m.token)}
                className="mt-2.5 rounded-lg bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-3 py-1.5 text-xs font-bold text-white hover:brightness-110"
              >
                {actionLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type AuthUser = NonNullable<
  ApiResponse<typeof api, "authLogin">["user"]
>;

type Mode = "login" | "register" | "forgot";

const FEATURES: Array<{ icon: string; color: string; label: string }> = [
  { icon: "globe", color: "#2E6BFF", label: "Website" },
  { icon: "bag", color: "#F43F5E", label: "Marketplace" },
  { icon: "building", color: "#7C4DFF", label: "Sistem Bisnis" },
  { icon: "phone", color: "#22C55E", label: "Aplikasi Android" },
  { icon: "chart", color: "#F59E0B", label: "Dashboard" },
  { icon: "grid", color: "#A78BFA", label: "Dan Lainnya" },
];

const STATS = [
  { value: "10.000+", label: "Project Dibuat" },
  { value: "4,8/5", label: "Rating Pengguna" },
  { value: "99%", label: "Berhasil Deploy" },
];

export function AuthView({
  onAuthenticated,
}: {
  onAuthenticated: (token: string, user: AuthUser) => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [forgotStep, setForgotStep] = useState<"request" | "token">("request");
  const [resetToken, setResetToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const finish = (res: { ok: boolean; token: string | null; error: string | null; user: AuthUser | null }) => {
    if (res.ok && res.token && res.user) {
      onAuthenticated(res.token, res.user);
    } else {
      setError(res.error ?? "Gagal masuk. Coba lagi.");
    }
  };

  const login = useMutation({
    mutationFn: () => api.authLogin({ email: email.trim(), password }),
    onSuccess: finish,
    onError: () => setError("Tidak bisa terhubung. Coba lagi sebentar lagi."),
  });

  const register = useMutation({
    mutationFn: () =>
      api.authRegister({ name: name.trim(), email: email.trim(), password }),
    onSuccess: finish,
    onError: () => setError("Tidak bisa terhubung. Coba lagi sebentar lagi."),
  });

  // G9 — Login GitHub (OAuth asli), pola yang sama seperti Google (G8).
  // Tombol GitHub TIDAK lagi memakai akun demo: ia meminta URL otorisasi
  // dari server; bila kredensial belum lengkap, server menjawab error
  // jujur (tidak ada fallback ke akun demo). Setelah GitHub mengembalikan
  // pengguna ke URL aplikasi dengan code+state, effect di bawah
  // menyelesaikan login lewat aksi completeGitHubOAuth (penukaran code
  // terjadi server-side). Penanda provider disimpan di sessionStorage
  // sebelum redirect, karena callback Google dan GitHub sama-sama
  // memakai ?code=&state= di URL yang sama.
  const githubOAuth = useMutation({
    mutationFn: () => api.startGitHubOAuth({}),
    onSuccess: (res) => {
      if (res.ok && res.authUrl) {
        try {
          sessionStorage.setItem("dadiweb-oauth-provider", "github");
        } catch {
          // sessionStorage tidak tersedia — fallback di effect tetap jalan.
        }
        window.location.href = res.authUrl;
      } else {
        setError(res.error ?? "Login GitHub belum bisa dimulai.");
      }
    },
    onError: () => setError("Tidak bisa terhubung. Coba lagi sebentar lagi."),
  });

  // G8 — Login Google (OAuth asli). Tombol Google TIDAK lagi memakai
  // akun demo: ia meminta URL otorisasi dari server; bila kredensial
  // belum lengkap, server menjawab error jujur (tidak ada fallback ke
  // akun demo). Setelah Google mengembalikan pengguna ke URL aplikasi
  // dengan code+state, effect di bawah menyelesaikan login lewat aksi
  // completeGoogleOAuth (penukaran code terjadi server-side).
  const googleOAuth = useMutation({
    mutationFn: () => api.startGoogleOAuth({}),
    onSuccess: (res) => {
      if (res.ok && res.authUrl) {
        try {
          sessionStorage.setItem("dadiweb-oauth-provider", "google");
        } catch {
          // sessionStorage tidak tersedia — fallback di effect tetap jalan.
        }
        window.location.href = res.authUrl;
      } else {
        setError(res.error ?? "Login Google belum bisa dimulai.");
      }
    },
    onError: () => setError("Tidak bisa terhubung. Coba lagi sebentar lagi."),
  });

  // G8/G9 — intersep callback OAuth: Google/GitHub mengarahkan kembali
  // ke URL aplikasi dengan ?code=&state= (atau ?error= bila pengguna
  // membatalkan). Dijaga ref agar hanya berjalan sekali (StrictMode
  // bisa menjalankan effect dua kali; pemanggilan kedua akan ditolak
  // server karena state sudah terpakai, dan tidak boleh menimpa hasil
  // pertama). Query dibersihkan dari URL setelah diproses. Bila penanda
  // provider hilang, dicoba Google dulu lalu GitHub bila errornya
  // menyebut state tidak valid — aman karena consume state di tabel
  // yang salah gagal tanpa efek samping.
  const callbackHandled = useRef(false);
  useEffect(() => {
    if (callbackHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    if (!code && !state && !oauthError) return;
    callbackHandled.current = true;
    let provider: string | null = null;
    try {
      provider = sessionStorage.getItem("dadiweb-oauth-provider");
      sessionStorage.removeItem("dadiweb-oauth-provider");
    } catch {
      provider = null;
    }
    const cleanUrl = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      window.history.replaceState(null, "", url.toString());
    };
    if (oauthError) {
      if (provider === "github") {
        setError(
          oauthError === "access_denied"
            ? "Login GitHub dibatalkan."
            : "Login GitHub gagal. Silakan coba lagi dari tombol GitHub.",
        );
      } else {
        setError(
          oauthError === "access_denied"
            ? "Login Google dibatalkan."
            : "Login Google gagal. Silakan coba lagi dari tombol Google.",
        );
      }
      cleanUrl();
      return;
    }
    if (code && state) {
      void (async () => {
        const tryProvider = async (p: "google" | "github") => {
          return p === "github"
            ? api.completeGitHubOAuth({ code, state })
            : api.completeGoogleOAuth({ code, state });
        };
        try {
          if (provider === "github") {
            const res = await tryProvider("github");
            cleanUrl();
            finish(res);
            return;
          }
          if (provider === "google") {
            const res = await tryProvider("google");
            cleanUrl();
            finish(res);
            return;
          }
          const first = await tryProvider("google");
          if (first.ok && first.token && first.user) {
            cleanUrl();
            finish(first);
            return;
          }
          if (
            first.error?.includes("State login Google tidak valid")
          ) {
            const second = await tryProvider("github");
            cleanUrl();
            finish(second);
            return;
          }
          cleanUrl();
          finish(first);
        } catch {
          cleanUrl();
          setError("Tidak bisa terhubung. Coba lagi sebentar lagi.");
        }
      })();
    } else {
      cleanUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const demo = useMutation({
    mutationFn: () => api.authDemo({}),
    onSuccess: finish,
    onError: () => setError("Gagal membuka akun demo. Coba lagi."),
  });

  const requestReset = useMutation({
    mutationFn: () => api.requestPasswordReset({ email: email.trim() }),
    onSuccess: () => {
      setForgotStep("token");
      setNotice(
        "Permintaan diterima. Bila email itu terdaftar, token reset (berlaku 60 menit, sekali pakai) sudah diterbitkan ke kotak masuk simulasi di bawah.",
      );
    },
    onError: () => setError("Tidak bisa terhubung. Coba lagi sebentar lagi."),
  });

  const doReset = useMutation({
    mutationFn: () =>
      api.resetPasswordWithToken({
        token: resetToken.trim(),
        newPassword: password,
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setNotice(
          "Kata sandi berhasil diganti dan semua sesi lama dicabut. Silakan masuk dengan kata sandi baru.",
        );
        setError(null);
        setPassword("");
        setConfirm("");
        setResetToken("");
        setForgotStep("request");
        setMode("login");
      } else {
        setError(res.error ?? "Gagal mengganti kata sandi.");
      }
    },
    onError: () => setError("Tidak bisa terhubung. Coba lagi sebentar lagi."),
  });

  const busy =
    login.isPending ||
    register.isPending ||
    githubOAuth.isPending ||
    googleOAuth.isPending ||
    requestReset.isPending ||
    doReset.isPending ||
    demo.isPending;

  const switchMode = (next: Mode) => {
    setMode(next);
    setForgotStep("request");
    setResetToken("");
    setError(null);
    setNotice(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === "register") {
      if (name.trim().length < 2) return setError("Nama lengkap minimal 2 karakter.");
      if (password.length < 8) return setError("Kata sandi minimal 8 karakter.");
      if (password !== confirm) return setError("Konfirmasi kata sandi tidak sama.");
      register.mutate();
      return;
    }
    if (mode === "forgot") {
      if (forgotStep === "request") {
        if (!email.includes("@")) return setError("Masukkan email yang valid.");
        requestReset.mutate();
        return;
      }
      if (resetToken.trim().length < 10)
        return setError("Tempel token dari kotak masuk simulasi terlebih dahulu.");
      if (password.length < 8) return setError("Kata sandi baru minimal 8 karakter.");
      if (password !== confirm) return setError("Konfirmasi kata sandi tidak sama.");
      doReset.mutate();
      return;
    }
    login.mutate();
  };

  const inputCls =
    "w-full rounded-xl border border-[var(--border)] bg-[#0A1130] px-3.5 py-2.5 text-sm text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none";

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto grid min-h-screen max-w-[1400px] lg:grid-cols-2">
        {/* Left — brand panel (dari desain Login/Register user) */}
        <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#141D4D] via-[#0B1238] to-[#05081A] px-10 py-10 lg:flex lg:flex-col">
          <div className="flex items-center gap-2.5">
            <Logo size={38} />
            <p className="text-2xl font-extrabold tracking-tight">
              dadi<span className="text-[#2E6BFF]">web</span>
            </p>
          </div>
          <div className="relative z-10 mt-12 max-w-md">
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
              Website dan Aplikasi
              <br />
              Jadi dengan AI
            </h1>
            <p className="mt-3 text-[15px] text-[var(--dim)]">
              Cukup ketik ide, biar AI yang kerjakan.
            </p>
            <ul className="mt-7 space-y-3">
              {FEATURES.map((f) => (
                <li key={f.label} className="flex items-center gap-3 text-[15px] font-semibold">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                    style={{ background: f.color }}
                  >
                    <Icon name={f.icon} size={16} />
                  </span>
                  {f.label}
                </li>
              ))}
            </ul>
          </div>
          <img
            src={heroImg}
            alt=""
            className="pointer-events-none absolute -right-16 bottom-24 w-[62%] max-w-[480px] opacity-80"
            style={{
              maskImage: "linear-gradient(to left, black 55%, transparent)",
              WebkitMaskImage: "linear-gradient(to left, black 55%, transparent)",
            }}
          />
          <div className="relative z-10 mt-auto grid grid-cols-3 gap-3 border-t border-white/10 pt-6">
            {STATS.map((s) => (
              <div key={s.label}>
                <p className="text-xl font-extrabold tnum">{s.value}</p>
                <p className="mt-0.5 text-xs text-[var(--dim)]">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Right — form */}
        <section className="flex items-center justify-center px-4 py-10 pt-safe sm:px-8">
          <div className="w-full max-w-[420px]">
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <Logo size={34} />
              <p className="text-xl font-extrabold tracking-tight">
                dadi<span className="text-[#2E6BFF]">web</span>
              </p>
            </div>

            <h2 className="text-2xl font-extrabold tracking-tight">
              {mode === "forgot" ? "Atur Ulang Kata Sandi" : "Masuk ke Akun Anda"}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
              {mode === "forgot"
                ? forgotStep === "request"
                  ? "Masukkan email akunmu — token reset sekali pakai (berlaku 60 menit) diterbitkan ke kotak masuk simulasi di dalam aplikasi."
                  : "Tempel token dari kotak masuk simulasi di bawah, lalu buat kata sandi baru. Setelah berhasil, semua sesi lama akunmu dicabut."
                : "Mulai wujudkan ide menjadi website dan aplikasi."}
            </p>

            {mode !== "forgot" && (
              <div
                className="mt-6 grid grid-cols-2 rounded-xl bg-[var(--surface)] p-1 ring-1 ring-[var(--border-soft)]"
                role="tablist"
                aria-label="Masuk atau daftar"
              >
                {(
                  [
                    { key: "login", label: "Masuk" },
                    { key: "register", label: "Daftar" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={mode === t.key}
                    onClick={() => switchMode(t.key)}
                    className={`rounded-lg py-2 text-sm font-bold transition ${
                      mode === t.key
                        ? "bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] text-white"
                        : "text-[var(--dim)] hover:text-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={onSubmit} className="mt-5 space-y-3.5" noValidate={false}>
              {mode === "register" && (
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold">Nama lengkap</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={60}
                    autoComplete="name"
                    placeholder="Nama kamu"
                    className={inputCls}
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={120}
                  autoComplete="email"
                  placeholder="nama@email.com"
                  className={inputCls}
                />
              </label>
              {mode === "forgot" && forgotStep === "token" && (
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold">
                    Token reset (dari kotak masuk simulasi)
                  </span>
                  <input
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    required
                    maxLength={120}
                    autoComplete="off"
                    placeholder="Tempel token di sini"
                    className={`${inputCls} font-mono`}
                  />
                </label>
              )}
              {(mode !== "forgot" || forgotStep === "token") && (
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold">
                  {mode === "forgot" ? "Kata sandi baru" : "Password"}
                </span>
                <span className="relative block">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={mode === "login" ? 1 : 8}
                    maxLength={72}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder="••••••••"
                    className={`${inputCls} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--dim)] hover:bg-white/8 hover:text-white"
                  >
                    <Icon name="eye" size={17} />
                  </button>
                </span>
              </label>
              )}
              {mode !== "login" && (mode !== "forgot" || forgotStep === "token") && (
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold">Konfirmasi kata sandi</span>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </label>
              )}

              {mode === "login" && (
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="text-[13px] font-semibold text-[#6EA8FF] hover:underline"
                  >
                    Lupa password?
                  </button>
                </div>
              )}

              {error && (
                <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">
                  {notice}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] py-3 text-sm font-bold text-white shadow-lg shadow-indigo-900/50 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
              >
                {busy
                  ? "Memproses…"
                  : mode === "register"
                    ? "Daftar Sekarang"
                    : mode === "forgot"
                      ? forgotStep === "request"
                        ? "Kirim Token Reset"
                        : "Atur Ulang Kata Sandi"
                      : "Masuk Sekarang"}
              </button>
            </form>

            {mode === "forgot" && forgotStep === "token" && (
              <div className="mt-5">
                <SimulatedInbox
                  email={email.trim()}
                  purpose="reset_password"
                  actionLabel="Pakai Token Ini"
                  onUseToken={(t) => {
                    setResetToken(t);
                    setError(null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => requestReset.mutate()}
                  disabled={requestReset.isPending}
                  className="mt-3 text-[13px] font-semibold text-[#6EA8FF] hover:underline disabled:opacity-60"
                >
                  Token tidak masuk / kedaluwarsa? Kirim token baru
                </button>
              </div>
            )}

            {mode === "forgot" ? (
              <button
                onClick={() => switchMode("login")}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#6EA8FF] hover:underline"
              >
                <Icon name="back" size={14} /> Kembali masuk
              </button>
            ) : (
              <>
                <div className="my-5 flex items-center gap-3 text-xs text-[var(--dim)]">
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  atau masuk dengan
                  <span className="h-px flex-1 bg-[var(--border)]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => googleOAuth.mutate()}
                    disabled={busy}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-bold transition hover:bg-[var(--surface-2)] disabled:opacity-60"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[12px] font-extrabold text-[#4285F4]">G</span>
                    {googleOAuth.isPending ? "Menghubungkan…" : "Google"}
                  </button>
                  <button
                    onClick={() => githubOAuth.mutate()}
                    disabled={busy}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-bold transition hover:bg-[var(--surface-2)] disabled:opacity-60"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[12px] font-extrabold text-slate-900">GH</span>
                    {githubOAuth.isPending ? "Menghubungkan…" : "GitHub"}
                  </button>
                </div>
                <p className="mt-2.5 text-center text-[11px] leading-relaxed text-[var(--dim-2)]">
                  Masuk dengan Google dan GitHub memakai OAuth asli bila
                  admin sudah memasang kredensialnya di Pengaturan
                  Platform; bila belum, tombol menampilkan pesan belum
                  aktif (tanpa akun demo).
                </p>

                <p className="mt-6 text-center text-sm text-[var(--dim)]">
                  {mode === "login" ? (
                    <>
                      Belum punya akun?{" "}
                      <button onClick={() => switchMode("register")} className="font-bold text-[#6EA8FF] hover:underline">
                        Daftar Sekarang
                      </button>
                    </>
                  ) : (
                    <>
                      Sudah punya akun?{" "}
                      <button onClick={() => switchMode("login")} className="font-bold text-[#6EA8FF] hover:underline">
                        Masuk Sekarang
                      </button>
                    </>
                  )}
                </p>

                <div className="mt-5 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-4">
                  <p className="text-[13px] font-bold">Akun demo dari desainmu</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
                    Masuk langsung sebagai Budi Santoso (Pro Plan) — profil contoh
                    dari desainmu — tanpa perlu kata sandi.
                  </p>
                  <button
                    onClick={() => demo.mutate()}
                    disabled={busy}
                    className="mt-2.5 rounded-lg bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-3.5 py-2 text-[13px] font-bold text-white transition hover:brightness-110 disabled:opacity-60"
                  >
                    {demo.isPending ? "Membuka demo…" : "Masuk sebagai Demo"}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
