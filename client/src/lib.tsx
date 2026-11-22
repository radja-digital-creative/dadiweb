import type { ReactNode } from "react";
import type { ApiResponse } from "./api";
import type { api } from "./api";

export type State = ApiResponse<typeof api, "getState">;
export type Project = State["projects"][number];
export type SiteSpec = NonNullable<Project["spec"]>;
export type Template = State["templates"][number];
export type ProjectDetail = ApiResponse<typeof api, "getProjectDetail">;

export type View =
  | "dashboard"
  | "create"
  | "projects"
  | "templates"
  | "database"
  | "deploy"
  | "android"
  | "integrations"
  | "credits"
  | "community"
  | "help"
  | "settings"
  | "admin"
  | "editor"
  | "project";

export const NAV_MAIN: Array<{ view: View; label: string; icon: string }> = [
  { view: "dashboard", label: "Dashboard", icon: "home" },
  { view: "create", label: "Buat dengan AI", icon: "spark" },
  { view: "projects", label: "Proyek Saya", icon: "folder" },
  { view: "templates", label: "Template", icon: "grid" },
  { view: "database", label: "Database", icon: "db" },
  { view: "deploy", label: "Domain & Deploy", icon: "globe" },
  { view: "android", label: "Aplikasi Android", icon: "phone" },
  { view: "integrations", label: "Integrasi API", icon: "link" },
  { view: "credits", label: "Kredit & Langganan", icon: "card" },
  { view: "community", label: "Komunitas", icon: "users" },
  { view: "help", label: "Bantuan", icon: "help" },
];

export const STAGE_META: Array<{ key: string; label: string; cost: number; desc: string }> = [
  { key: "planner", label: "Planner", cost: 40, desc: "Menganalisis prompt & merancang struktur situs" },
  { key: "designer", label: "Designer", cost: 60, desc: "Memilih warna, tipografi & tata letak" },
  { key: "coder", label: "Coder", cost: 120, desc: "Menulis kode halaman & fitur" },
  { key: "builder", label: "Builder & Tester", cost: 50, desc: "Membangun proyek & menguji hasil render" },
  { key: "fixer", label: "Fixer", cost: 30, desc: "Memperbaiki error & pemeriksaan akhir" },
];

export const CATEGORY_CHIPS = [
  "Website",
  "Marketplace",
  "Sistem Bisnis",
  "Aplikasi Android",
  "Dashboard",
  "Lainnya",
];

export const EXAMPLE_PROMPTS = [
  {
    icon: "building",
    color: "#2E6BFF",
    title: "Website Company Profile",
    text: "Buatkan company profile untuk jasa konstruksi dengan halaman layanan, portofolio proyek, dan formulir kontak WhatsApp",
  },
  {
    icon: "bag",
    color: "#7C4DFF",
    title: "Marketplace",
    text: "Buatkan marketplace seperti Shopee untuk jual beli HP dengan fitur chat AI, pembayaran DOKU, dan sistem langganan toko",
  },
  {
    icon: "calendar",
    color: "#0D9488",
    title: "Sistem Booking",
    text: "Buatkan sistem booking untuk event organizer dengan kalender jadwal, pembayaran DP, dan notifikasi WhatsApp otomatis",
  },
  {
    icon: "calc",
    color: "#F59E0B",
    title: "Aplikasi Kasir",
    text: "Buatkan aplikasi kasir untuk toko retail dengan stok barang, laporan penjualan harian, dan cetak struk",
  },
  {
    icon: "chart",
    color: "#2563EB",
    title: "Dashboard Admin",
    text: "Buatkan dashboard admin untuk manajemen proyek dengan statistik pendapatan, tabel data, dan manajemen pengguna",
  },
  {
    icon: "phone",
    color: "#22C55E",
    title: "Aplikasi Android",
    text: "Buatkan aplikasi Android untuk katalog produk toko saya lengkap dengan keranjang dan checkout",
  },
];

export const INTEGRATIONS: Array<{
  key: string;
  name: string;
  desc: string;
  color: string;
  letter: string;
  keyLabel: string;
}> = [
  { key: "doku", name: "DOKU Payment Gateway", desc: "Pembayaran online", color: "#E11D48", letter: "D", keyLabel: "Client ID / API Key DOKU" },
  { key: "whatsapp", name: "WhatsApp API", desc: "Notifikasi & Chat Bot", color: "#22C55E", letter: "W", keyLabel: "API Token WhatsApp" },
  { key: "gmaps", name: "Google Maps", desc: "Peta & Lokasi", color: "#F59E0B", letter: "G", keyLabel: "API Key Google Maps" },
  { key: "email", name: "Email Service", desc: "Kirim email otomatis", color: "#2E6BFF", letter: "E", keyLabel: "API Key Email Service" },
  { key: "openai", name: "AI API (OpenAI)", desc: "Fitur AI dalam aplikasi", color: "#111827", letter: "AI", keyLabel: "API Key OpenAI" },
];

export const PLANS = [
  {
    name: "Free",
    price: 0,
    credits: 200,
    features: ["200 kredit / bulan", "2 proyek aktif", "Subdomain dadiweb.id", "Template dasar"],
  },
  {
    name: "Pro Plan",
    price: 299000,
    credits: 5000,
    features: [
      "5.000 kredit / bulan",
      "Proyek tanpa batas",
      "Deploy tanpa batas",
      "Aplikasi Android",
      "Integrasi API",
      "Support Prioritas",
    ],
  },
  {
    name: "Bisnis",
    price: 799000,
    credits: 15000,
    features: [
      "15.000 kredit / bulan",
      "Semua fitur Pro",
      "Domain custom + SSL",
      "Tim hingga 10 anggota",
      "Support 24/7",
    ],
  },
];

export const TOPUP_PACKS = [
  { label: "500 kredit", credits: 500, price: 49000 },
  { label: "1.500 kredit", credits: 1500, price: 129000 },
  { label: "5.000 kredit", credits: 5000, price: 349000 },
];

export const FAQ_ITEMS = [
  {
    q: "Bagaimana cara membuat website dengan Dadiweb?",
    a: "Buka menu Buat dengan AI, tulis deskripsi website yang kamu inginkan sedetail mungkin, lalu tekan Buat Sekarang. Pipeline AI Dadiweb (Planner → Designer → Coder → Builder → Fixer) akan membangunnya, dan hasilnya langsung bisa dipratinjau di Editor.",
  },
  {
    q: "Bagaimana kredit dihitung?",
    a: "Setiap tahap pipeline memakai kredit: Planner 40, Designer 60, Coder 120, Builder & Tester 50, Fixer 30 — total 300 kredit per website. Deploy memakai 25 kredit. Semua tercatat transparan di buku besar pada menu Kredit & Langganan.",
  },
  {
    q: "Bagaimana cara deploy ke domain sendiri?",
    a: "Buka menu Domain & Deploy, pilih proyek, lalu tambahkan domainmu di bagian Domain Custom. Pasang TXT record verifikasi yang ditampilkan di DNS domainmu, klik Verifikasi, dan domain langsung aktif dengan SSL otomatis. Subdomain *.dadiweb.id tetap bisa dipakai bersamaan.",
  },
  {
    q: "Bagaimana cara membuat aplikasi Android?",
    a: "Buka menu Aplikasi Android, pilih proyek web, isi nama aplikasi dan Package ID (mis. com.tokosaya.app), pilih APK atau AAB, lalu tekan Build. Setiap build menaikkan versi otomatis, tercatat di riwayat build, dan memakai 150 kredit. Paket build (manifest Capacitor) bisa diunduh untuk diproses menjadi biner di pipeline rilis.",
  },
  {
    q: "Bagaimana mengintegrasikan pembayaran DOKU?",
    a: "Buka menu Integrasi API, aktifkan DOKU Payment Gateway, lalu simpan Client ID/API key dan URL webhook kamu. Kunci hanya disimpan sebagai petunjuk 4 karakter terakhir — aplikasi hasil generate memakai konfigurasi ini saat pembayaran dijalankan.",
  },
  {
    q: "Bisakah saya mengedit hasil AI?",
    a: "Bisa. Di Editor & Preview kamu dapat mengubah nama situs, headline, subheadline, dan teks tombol utama, lalu menyimpannya. Kamu juga bisa menduplikat proyek, mengekspor kodenya sebagai file, dan mengelola database-nya di menu Database.",
  },
  {
    q: "Bagaimana cara mengganti paket langganan?",
    a: "Di menu Kredit & Langganan, pilih paket Free, Pro Plan, atau Bisnis lalu tekan tombol ganti paket. Upgrade menambah selisih kuota ke saldomu pada periode berjalan dan tercatat di buku besar kredit.",
  },
];

export const COMMUNITY_POSTS = [
  { title: "Contoh Prompt untuk Marketplace", author: "Andi", time: "2 jam lalu", comments: 12, likes: 5, tag: "Inspirasi" },
  { title: "Cara deploy custom domain", author: "Budi", time: "1 hari lalu", comments: 8, likes: 3, tag: "Tutorial" },
  { title: "Template terbaik untuk company profile", author: "Sari", time: "1 hari lalu", comments: 15, likes: 7, tag: "Diskusi" },
  { title: "Integrasi DOKU di aplikasi", author: "Rudi", time: "2 hari lalu", comments: 9, likes: 4, tag: "Tutorial" },
];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function fmtIdr(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

export function fmtNum(n: number): string {
  return n.toLocaleString("id-ID");
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function statusBadge(status: string): { label: string; cls: string } {
  if (status === "online")
    return { label: "Online", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
  if (status === "archived")
    return { label: "Arsip", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
  return { label: "Draft", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, stroke style)
// ---------------------------------------------------------------------------

const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1Z" />,
  spark: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  db: <><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5V12c0 1.7 3.6 3 8 3s8-1.3 8-3V5.5" /><path d="M4 12v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3Z" /></>,
  phone: <rect x="7" y="2.5" width="10" height="19" rx="2.5" />,
  link: <path d="M10 14a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 10a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />,
  card: <><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5M16 5.5a3.5 3.5 0 0 1 0 6.5M17.8 15.3c2 .6 3.3 2.1 3.8 4.7" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.3A2.6 2.6 0 0 1 12 7.5c1.4 0 2.5 1 2.5 2.2 0 1.7-2.3 2-2.3 3.6M12 17.2h.01" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20.5 20.5-4.8-4.8" /></>,
  bell: <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9ZM10 20a2.2 2.2 0 0 0 4 0" />,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  bolt: <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />,
  crown: <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-1.6 10.5a1 1 0 0 1-1 .5H5.6a1 1 0 0 1-1-.5L3 8Z" />,
  eye: <><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="3" /></>,
  edit: <path d="M17 3.5a2.8 2.8 0 1 1 4 4L8 20.5l-5 1 1-5L17 3.5Z" />,
  dots: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  ext: <path d="M14 4h6v6M20 4 11 13M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />,
  arrow: <path d="M4 12h15m-6-7 7 7-7 7" />,
  back: <path d="M20 12H5m6 7-7-7 7-7" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M9 20h6M12 16v4" /></>,
  code: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" />,
  rocket: <><path d="M12 15c5-3.5 7-8.5 7-12-3.5 0-8.5 2-12 7l-2.5 5.5L10 13c-1 2.5-3 4.5-6 5.5C4.5 15.5 6 12.5 8.5 11L6 8.5C8.5 9 11 10.5 12 15Z" /><circle cx="14.5" cy="9.5" r="1.8" /></>,
  trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7" />,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8 13.2 6a7 7 0 0 1 2.6 1.5l3-1L21 9.5l-2.3 2.5a7 7 0 0 1 0 3L21 17.5l-2.2 3-3-1a7 7 0 0 1-2.6 1.5L12 21.2 10.8 18a7 7 0 0 1-2.6-1.5l-3 1L3 14.5 5.3 12a7 7 0 0 1 0-3L3 6.5l2.2-3 3 1A7 7 0 0 1 10.8 6L12 2.8Z" transform="scale(0.92) translate(1 1)" /></>,
  shield: <path d="M12 3 5 5.8v5.4c0 4.4 2.9 7.6 7 9.3 4.1-1.7 7-4.9 7-9.3V5.8L12 3Z" />,
  book: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5ZM4 18V5.5M20 18H6.5" />,
  play: <path d="M7 4.8v14.4L19 12 7 4.8Z" />,
  chat: <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z" />,
  logout: <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9" />,
  upload: <path d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16" />,
  attach: <path d="m20 11.5-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L12 3.9a3.7 3.7 0 0 1 5.2 5.2l-8.1 8.1a1.8 1.8 0 0 1-2.6-2.6l7.4-7.4" />,
  building: <><rect x="5" y="3" width="14" height="18" /><path d="M9 7h2m2 0h2M9 11h2m2 0h2M9 15h2m2 0h2M3 21h18" /></>,
  bag: <path d="M5 8h14l-1.2 12.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3L5 8ZM8.5 10.5v-2a3.5 3.5 0 0 1 7 0v2" />,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 10h17M8 3v4m8-4v4" /></>,
  calc: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 7h7M8.5 12h.01m3.5 0h.01m3.5 0h.01M8.5 15.5h.01m3.5 0h.01m3.5 0h.01M8.5 19h.01m3.5 0h.01m3.5 0h.01" /></>,
  chart: <path d="M4 20V10m5.5 10V4M15 20v-8m5.5 8V7" />,
  table: <><rect x="3.5" y="4" width="17" height="16" rx="1.5" /><path d="M3.5 9.5h17M3.5 15h17M9.5 9.5V20M15 9.5V20" /></>,
  wand: <path d="m5 19 9.5-9.5M15 4l.6 1.9L17.5 6.5l-1.9.6L15 9l-.6-1.9L12.5 6.5l1.9-.6L15 4ZM20 10l.4 1.3 1.3.4-1.3.4L20 13.4l-.4-1.3-1.3-.4 1.3-.4L20 10ZM6 3l.4 1.3L7.7 4.7 6.4 5.1 6 6.4 5.6 5.1 4.3 4.7l1.3-.4L6 3Z" />,
  download: <path d="M12 4v12m0 0 5-5m-5 5-5-5M4 20h16" />,
  database2: <path d="M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z" />,
};

export function Icon({
  name,
  size = 20,
  className = "",
  strokeWidth = 1.8,
}: {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name] ?? PATHS["spark"]}
    </svg>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="dwlogo" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0%" stopColor="#39B6FF" />
          <stop offset="55%" stopColor="#2E6BFF" />
          <stop offset="100%" stopColor="#7C4DFF" />
        </linearGradient>
      </defs>
      <path
        d="M24 3 41 12.8v22.4L24 45 7 35.2V12.8L24 3Z"
        fill="none"
        stroke="url(#dwlogo)"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path d="M24 15v18" stroke="url(#dwlogo)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// CSS-drawn website thumbnail (used for templates & projects)
// ---------------------------------------------------------------------------

export function SiteThumb({
  hue,
  primary,
  className = "",
  tall = false,
}: {
  hue?: number;
  primary?: string;
  className?: string;
  tall?: boolean;
}) {
  const base = primary ?? `hsl(${hue ?? 230} 85% 55%)`;
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        background: `linear-gradient(150deg, hsl(${hue ?? 230} 70% 16%), hsl(${hue ?? 230} 65% 8%))`,
        aspectRatio: tall ? "4/3" : "16/10",
      }}
      aria-hidden="true"
    >
      <div className="absolute inset-x-[10%] top-[12%] bottom-[10%] rounded-md bg-[#0B1233]/90 shadow-xl ring-1 ring-white/10 overflow-hidden">
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10">
          <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
          <span className="ml-1 h-1.5 flex-1 rounded-full bg-white/15" />
        </div>
        <div className="p-2 space-y-1.5">
          <div className="h-2 w-3/5 rounded-sm" style={{ background: base }} />
          <div className="h-1.5 w-4/5 rounded-sm bg-white/25" />
          <div className="h-1.5 w-2/3 rounded-sm bg-white/15" />
          <div className="flex gap-1.5 pt-0.5">
            <div className="h-4 w-10 rounded-sm" style={{ background: base }} />
            <div className="h-4 w-10 rounded-sm bg-white/15" />
          </div>
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <div className="h-5 rounded-sm bg-white/12" />
            <div className="h-5 rounded-sm bg-white/12" />
            <div className="h-5 rounded-sm bg-white/12" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live preview of a generated site, rendered from its structured spec.
// G12 — CATATAN RETENSI: komponen ini DIPERTAHANKAN hanya sebagai
// thumbnail ringkas di tab Preview Editor (views-projects.tsx:841,
// mode compact) — BUKAN lagi jalur tampilan situs. Tampilan situs yang
// sesungguhnya (panel Preview + modal Tinjau Preview di
// views-project-chat.tsx dan situs publik di views-public.tsx) kini
// memakai renderer statis tunggal server (server/src/site-render.ts)
// lewat <iframe srcDoc>, sehingga preview = publik untuk snapshot yang
// sama. Menghapus komponen ini akan merusak tab Preview Editor tanpa
// mengganti thumbnailnya, jadi ia dipertahankan dengan alasan ini,
// bukan diam-diam — dan desain kanoniknya di-port ke site-render.ts.
// ---------------------------------------------------------------------------

export function SitePreview({
  spec,
  compact = false,
}: {
  spec: SiteSpec;
  compact?: boolean;
}) {
  const primary = spec.primaryColor || "#2E6BFF";
  const accent = spec.accentColor || "#F97316";
  return (
    <div className="bg-white text-slate-900 overflow-hidden">
      <div
        className="px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5"
        style={{ background: primary }}
      >
        <span className="min-w-0 break-words text-white font-extrabold tracking-tight text-sm sm:text-base">
          {spec.siteName}
        </span>
        <nav className="hidden flex-wrap gap-x-4 gap-y-1 text-white/85 text-xs font-medium min-[420px]:flex">
          {spec.pages.slice(0, 4).map((p) => (
            <span key={p} className="whitespace-nowrap">{p}</span>
          ))}
        </nav>
        <span
          className="ml-auto shrink-0 whitespace-nowrap text-white text-[11px] font-bold px-2.5 py-1 rounded-full"
          style={{ background: accent }}
        >
          {spec.ctaLabel}
        </span>
      </div>
      <div className={`px-5 ${compact ? "py-6" : "py-10"} text-center`}>
        <h3
          className={`font-extrabold tracking-tight text-slate-900 ${
            compact ? "text-xl" : "text-2xl sm:text-4xl"
          }`}
        >
          {spec.headline}
        </h3>
        <p className="mt-2 text-slate-500 text-sm max-w-md mx-auto">
          {spec.subheadline}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span
            className="text-white text-sm font-bold px-4 py-2 rounded-lg"
            style={{ background: primary }}
          >
            {spec.ctaLabel}
          </span>
          <span className="text-sm font-semibold px-4 py-2 rounded-lg border border-slate-300 text-slate-600">
            Pelajari Dulu
          </span>
        </div>
      </div>
      {!compact && (
        <div className="px-5 pb-8 grid gap-3 sm:grid-cols-2">
          {spec.features.slice(0, 4).map((f, i) => (
            <div key={f.title} className="rounded-xl border border-slate-200 p-4">
              <div
                className="h-8 w-8 rounded-lg mb-2 flex items-center justify-center text-white text-sm font-extrabold"
                style={{ background: i % 2 === 0 ? primary : accent }}
              >
                {f.title.charAt(0)}
              </div>
              <p className="font-bold text-sm">{f.title}</p>
              <p className="text-xs text-slate-500 mt-1">{f.description}</p>
            </div>
          ))}
        </div>
      )}
      <div className="px-5 py-3 bg-slate-900 text-slate-300 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 break-words">{spec.siteName}</span>
        <span className="min-w-0 break-words">{spec.sections.join(" · ")}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credit donut
// ---------------------------------------------------------------------------

const USAGE_COLORS: Record<string, string> = {
  "AI Coding": "#2E6BFF",
  Gambar: "#F59E0B",
  Database: "#B45309",
  Lainnya: "#64748B",
};

export function CreditDonut({
  usage,
  balance,
  quota,
  size = 168,
}: {
  usage: Array<{ category: string; used: number }>;
  balance: number;
  quota: number;
  size?: number;
}) {
  const totalUsed = usage.reduce((s, u) => s + u.used, 0);
  const r = 62;
  const circumference = 2 * Math.PI * r;
  let offsetAcc = 0;
  const segments = usage.map((u) => {
    const frac = totalUsed > 0 ? u.used / totalUsed : 0;
    const dash = frac * circumference;
    const seg = {
      category: u.category,
      color: USAGE_COLORS[u.category] ?? "#94A3B8",
      dash,
      gap: circumference - dash,
      offset: -offsetAcc,
    };
    offsetAcc += dash;
    return seg;
  });
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 160 160" className="-rotate-90">
        <circle cx="80" cy="80" r={r} fill="none" stroke="#1E2A52" strokeWidth="16" />
        {segments.map((s) => (
          <circle
            key={s.category}
            cx="80"
            cy="80"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="16"
            strokeDasharray={`${Math.max(s.dash - 3, 0)} ${s.gap + 3}`}
            strokeDashoffset={s.offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold tnum">{fmtNum(balance)}</span>
        <span className="text-xs text-[var(--dim)]">dari {fmtNum(quota)}</span>
      </div>
    </div>
  );
}

export function UsageLegend({
  usage,
}: {
  usage: Array<{ category: string; used: number }>;
  quota?: number;
}) {
  const totalUsed = usage.reduce((s, u) => s + u.used, 0);
  // Largest-remainder rounding so the percentages always add up to exactly
  // 100% (plain per-item rounding could total 99% or 101%).
  const exact = usage.map((u) =>
    totalUsed > 0 ? (u.used / totalUsed) * 100 : 0,
  );
  const floors = exact.map((v) => Math.floor(v));
  let remainder = totalUsed > 0 ? 100 - floors.reduce((s, v) => s + v, 0) : 0;
  const byFraction = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const pcts = [...floors];
  for (const { i } of byFraction) {
    if (remainder <= 0) break;
    pcts[i] = (pcts[i] ?? 0) + 1;
    remainder -= 1;
  }
  return (
    <ul className="space-y-2">
      {usage.map((u, idx) => (
        <li key={u.category} className="flex items-center gap-2 text-sm">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ background: USAGE_COLORS[u.category] ?? "#94A3B8" }}
          />
          <span className="flex-1 text-[var(--dim)]">{u.category}</span>
          <span className="tnum font-semibold">{pcts[idx] ?? 0}%</span>
        </li>
      ))}
    </ul>
  );
}

// Download a text payload as a file (project export, build manifest, CSV).
export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Parser CSV sederhana untuk impor tabel: mendukung nilai berkutip,
// kutip ganda sebagai escape, dan baris CRLF/LF.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
