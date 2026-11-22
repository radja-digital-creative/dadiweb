import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { Icon, fmtNum, timeAgo } from "./lib";
import type { Nav } from "./views-main";

// ---------------------------------------------------------------------------
// Tampilan project chat (31 Okt 2026; G6: klasifikasi pesan).
// Dua kolom di desktop: KIRI = thread chat (prompt awal + ringkasan hasil
// tiap tahap + pesan lanjutan + balasan AI), KANAN = details + preview.
// Di mobile kolom ditumpuk: chat di atas, details + preview di bawah.
// G6 — pesan kini lewat sendChatMessage yang mengklasifikasikan:
// sapaan dan tanya/diskusi dijawab GRATIS (penanda "Tanpa potongan
// kredit" pada balasan), perintah build/iterasi menjalankan pipeline 5
// tahap yang sama dengan generate, tarif = tarif generate yang berlaku,
// hanya dipotong bila sukses. Panel details menampilkan bagian "Rencana"
// (planner MD proyek). Editor lama tetap bisa dibuka dari panel details.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// G12 — Frame situs statis bersama untuk panel Preview dan modal Tinjau
// Preview: SATU <iframe srcDoc> yang menampilkan HTML dari renderer
// tunggal server (aksi buildSiteFiles). Panel dan modal tidak lagi
// merender SitePreview React sendiri, jadi keduanya — dan situs publik —
// menampilkan file situs yang sama persis. sandbox="" (tanpa
// allow-scripts): HTML statis tidak memakai <script> sama sekali.
// ---------------------------------------------------------------------------
function SiteFileFrame({ html, title, heightClass }: { html: string; title: string; heightClass: string }) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox=""
      className={`block w-full border-0 ${heightClass}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Render planner MD sebagai tampilan manusia (brief UI 2 Nov 2026).
// Subset aman saja: heading #, ##, ###, list -, dan paragraf, plus
// tebal **...** / miring *...* sederhana. TIDAK pernah memakai
// dangerouslySetInnerHTML, jadi HTML mentah di MD dirender React sebagai
// teks biasa (escaped), bukan dieksekusi. Isi tidak diubah/dihapus:
// setiap baris MD tetap tampil, hanya tampilannya yang manusiawi.
// Contoh: "## Halaman" -> heading "Halaman"; "- Donat Kami" ->
// bullet "Donat Kami"; baris list kosong -> "(belum ada)".
// ---------------------------------------------------------------------------
function renderInlineMd(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={`${keyPrefix}-${i}`}>{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>;
  });
}

function renderPlannerMd(md: string): React.ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    out.push(
      <ul key={`ul-${out.length}`} className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
        {items.map((item, i) => (
          <li key={i}>{renderInlineMd(item.trim() === "" ? "(belum ada)" : item, `li-${out.length}-${i}`)}</li>
        ))}
      </ul>,
    );
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (line === "") {
      flushList();
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = (heading[1] ?? "#").length;
      const headingText = heading[2] ?? "";
      const text = headingText.trim() === "" ? "(belum ada)" : headingText.trim();
      const cls =
        level === 1
          ? "mt-4 text-base font-extrabold first:mt-0"
          : level === 2
            ? "mt-4 text-sm font-bold first:mt-0"
            : "mt-3 text-[13px] font-bold first:mt-0";
      out.push(
        <div key={`h-${idx}`} className={cls}>
          {renderInlineMd(text, `h-${idx}`)}
        </div>,
      );
      return;
    }
    const list = line.match(/^[-*]\s+(.*)$/);
    if (list) {
      listItems.push(list[1] ?? "");
      return;
    }
    if (line === "-" || line === "*") {
      listItems.push("");
      return;
    }
    flushList();
    out.push(
      <p key={`p-${idx}`} className="mt-1.5 text-[13px] leading-relaxed">
        {renderInlineMd(line, `p-${idx}`)}
      </p>,
    );
  });
  flushList();
  return out;
}

export function ProjectChatView({
  projectId,
  nav,
  token,
}: {
  projectId: number;
  nav: Nav;
  token: string;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clarifyQ, setClarifyQ] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  // UI Preview (brief 2 Nov 2026): mode bertahan selama tampilan proyek
  // ini dibuka (state tampilan saja, tidak disimpan ke DB).
  const [previewMode, setPreviewMode] = useState<"desktop" | "phone">("desktop");
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  useEffect(() => {
    if (!previewModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewModalOpen]);

  const detail = useQuery({
    queryKey: ["project-detail", projectId, token],
    queryFn: () => api.getProjectDetail({ token, projectId }),
  });
  // G12 — file situs proyek (working copy) dari spec terkini, dibangun
  // server lewat renderer tunggal; dipakai panel Preview DAN modal
  // Tinjau Preview. Hanya diambil bila proyek sudah punya spec — proyek
  // tanpa spec tetap menampilkan pesan jujur tanpa memanggil aksi ini.
  const siteFile = useQuery({
    queryKey: ["site-file", projectId, token],
    queryFn: () => api.buildSiteFiles({ token, projectId }),
    enabled: detail.data?.project?.spec != null,
  });
  const chat = useQuery({
    queryKey: ["project-chat", projectId, token],
    queryFn: () => api.getProjectChat({ token, projectId }),
  });
  // Berbagi cache dengan query ["dadiweb-state", token] di App.
  const state = useQuery({
    queryKey: ["dadiweb-state", token],
    queryFn: () => api.getState({ token }),
  });


  const sendChat = useMutation({
    mutationFn: (text: string) =>
      api.sendChatMessage({ token, projectId, prompt: text }),
    onMutate: () => {
      setError(null);
      setClarifyQ(null);
    },
    onSuccess: (res) => {
      if (res.routeStatus === "needs_clarification") {
        setClarifyQ(res.clarificationQuestion);
        setError(null);
        return;
      }
      if (!res.ok) {
        // G6 — gagal responder/build: input TIDAK dikosongkan agar
        // pengguna bisa kirim ulang tanpa mengetik ulang.
        setError(res.error ?? "Pesan gagal diproses. Coba lagi.");
        return;
      }
      setInput("");
      void queryClient.invalidateQueries({
        queryKey: ["project-detail", projectId],
      });
      // G12 — spec berubah setelah iterasi berhasil: file situs preview
      // harus dibangun ulang dari spec baru, bukan cache lama.
      void queryClient.invalidateQueries({
        queryKey: ["site-file", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["project-chat", projectId],
      });
      void queryClient.invalidateQueries({ queryKey: ["dadiweb-state"] });
    },
    onError: (e) => {
      setError(String(e instanceof Error ? e.message : e));
    },
  });

  const messages = chat.data?.messages ?? [];
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sendChat.isPending]);

  const project = detail.data?.project ?? null;
  const spec = project?.spec ?? null;
  const generations = detail.data?.generations ?? [];
  const tables = detail.data?.tables ?? [];
  const skillLabel = detail.data?.skillPlan?.label ?? null;

  const generateCost = state.data?.generateCost ?? 300;
  const balance = state.data?.account.balance ?? 0;
  const canAfford = balance >= generateCost;
  // G7 — pesan chat (sapaan/tanya/diskusi, 5 kredit/balasan) harus bisa
  // dikirim walau saldo di bawah tarif build; gerbang saldo hanya
  // berlaku di server untuk klasifikasi build (dan < 5 untuk chat).
  // Ambang input diturunkan agar "halo" dan "gas" bisa dikirim.
  const tooShort = input.trim().length < 2;
  const busy = sendChat.isPending;

  // Proyek lama (dibuat sebelum fitur chat) belum punya pesan tersimpan:
  // tampilkan fallback dari prompt awal + ringkasan generations, ditandai
  // sebagai riwayat build. Begitu iterasi pertama sukses, pesan tersimpan
  // mengambil alih dan fallback tidak lagi tampil.
  const fallbackBubbles =
    messages.length === 0 && project
      ? [
          { id: -2, role: "user", content: project.prompt, kind: "build" },
          {
            id: -1,
            role: "assistant",
            kind: "build",
            content:
              generations.length > 0
                ? `Website selesai dibuat — ${generations.filter((g) => g.status === "done").length} tahap tercatat: ${generations
                    .filter((g) => g.status === "done")
                    .map((g) => g.stage)
                    .join(", ")}. Kirim pesan lanjutan di chat ini untuk mengubah proyek.`
                : "Website ini belum punya riwayat build. Kirim pesan lanjutan di chat ini untuk mengubah proyek.",
          },
        ]
      : [];

  const bubbles = [
    ...fallbackBubbles,
    ...messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      kind: m.kind,
    })),
  ];

  if (detail.isPending) {
    return (
      <div>
        <p className="text-sm text-[var(--dim)]">Memuat proyek…</p>
      </div>
    );
  }
  if (!project) {
    return (
      <div>
        <button
          onClick={() => nav.go("projects")}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-[#6EA8FF] hover:underline"
        >
          <Icon name="arrow" size={14} /> Kembali ke Proyek Saya
        </button>
        <p role="alert" className="mt-4 text-sm text-rose-300">
          Proyek tidak ditemukan atau bukan milik akun ini.
        </p>
      </div>
    );
  }

  // Aliran chat: gelembung chat diurutkan waktu (createdAt).
  type TimelineItem =
    | {
        kind: "chat";
        id: number;
        role: string;
        content: string;
        kindLabel: string;
        createdAt: string;
      }

  const timeline: TimelineItem[] = [
    ...bubbles.map((m): TimelineItem => ({
      kind: "chat",
      id: m.id,
      role: m.role,
      content: m.content,
      kindLabel: m.kind,
      createdAt:
        m.id > 0
          ? (chat.data?.messages.find((x) => x.id === m.id)?.createdAt ??
            project.updatedAt)
          : m.id === -2
            ? project.createdAt
            : project.updatedAt,
    })),

  ].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={() => nav.go("projects")}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-[#6EA8FF] hover:underline"
          >
            <Icon name="arrow" size={14} /> Proyek Saya
          </button>
          <h1 className="mt-1 truncate text-2xl font-extrabold tracking-tight">
            {project.name}
          </h1>
          <p className="mt-1 text-sm text-[var(--dim)]">
            {project.slug}.dadiweb.id · {project.category} · Status:{" "}
            {project.status}
            {skillLabel ? ` · Skill: ${skillLabel}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => nav.go("editor", project.id)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-4 py-2 text-sm font-bold hover:bg-white/12"
          >
            <Icon name="edit" size={15} /> Buka Editor
          </button>
          <button
            onClick={() => nav.go("deploy", project.id)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2 text-sm font-bold text-white"
          >
            <Icon name="rocket" size={15} /> Deploy
          </button>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* KIRI — chat */}
        <section className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-[15px] font-bold">Chat Proyek</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--dim)]">
            Tanya atau diskusi soal proyek ini 5 kredit per balasan — AI
            perencana akan menjawab dan mencatat rencananya di bagian
            Rencana. Perintah build/iterasi (mis. “tambahkan halaman
            galeri”) menjalankan pipeline AI yang sama dengan generate: {fmtNum(generateCost)}{" "}
            kredit per iterasi yang berhasil; iterasi yang gagal tidak
            memotong saldo dan tidak mengubah proyek.
          </p>

          <div className="mt-4 flex flex-col gap-3">
            {timeline.length === 0 && (
              <p className="text-sm text-[var(--dim)]">
                Belum ada pesan. Mulai dengan pesan lanjutan di bawah.
              </p>
            )}
            {timeline.map((item) => (
                <div
                  key={item.id}
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    item.role === "user"
                      ? "self-end bg-[var(--accent)] text-white"
                      : "self-start bg-[#0A1130] text-slate-100 ring-1 ring-[var(--border-soft)]"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{item.content}</p>
                  <p
                    className={`mt-1.5 text-[11px] ${
                      item.role === "user" ? "text-white/70" : "text-[var(--dim)]"
                    }`}
                  >
                    {item.role === "user" ? "Kamu" : "Dadiweb AI"}
                    {item.kindLabel === "free" && item.role === "assistant"
                      ? " · Tanpa potongan kredit"
                      : ""}
                    {item.kindLabel === "chat" && item.role === "assistant"
                      ? " · 5 kredit"
                      : ""}
                    {item.id > 0 && chat.data
                      ? ` · ${timeAgo(
                          chat.data.messages.find((x) => x.id === item.id)
                            ?.createdAt ?? project.updatedAt,
                        )}`
                      : ""}
                  </p>
                </div>
            ))}
            {fallbackBubbles.length > 0 && (
              <p className="text-xs text-[var(--dim)]">
                Riwayat build — proyek ini dibuat sebelum fitur chat, jadi
                thread di atas disusun dari prompt awal dan riwayat tahapnya.
              </p>
            )}
            <div ref={chatEndRef} />
          </div>

          {clarifyQ && (
            <div
              role="alert"
              className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
            >
              <p className="font-bold">AI butuh satu klarifikasi:</p>
              <p className="mt-1">{clarifyQ}</p>
              <p className="mt-1 text-xs text-amber-200/80">
                Tidak ada kredit terpotong. Kirim ulang pesanmu dengan jawaban
                atas pertanyaan itu.
              </p>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
            >
              {error}
            </div>
          )}
          {!canAfford && (
            <p role="alert" className="mt-4 text-sm text-amber-300">
              Saldo kamu {fmtNum(balance)} kredit — belum cukup untuk build/
              iterasi ({fmtNum(generateCost)} kredit). Pesan tanya, diskusi,
              dan sapaan 5 kredit per balasan (saldo di bawah 5 tidak bisa
              chat); top up lewat menu Kredit &amp; Langganan bila ingin
              build.
            </p>
          )}

          <div className="mt-4">
            <label htmlFor="project-chat-input" className="sr-only">
              Pesan untuk proyek ini
            </label>
            <textarea
              id="project-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={busy}
              placeholder="Contoh: halo — atau: tambahkan halaman galeri foto dan ubah warna utama menjadi hijau tua."
              className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[#0A1130] p-4 text-[15px] leading-relaxed text-white placeholder:text-[var(--dim-2)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--dim)]">
                {tooShort && input.length > 0
                  ? "Minimal 2 karakter"
                  : `Saldo: ${fmtNum(balance)} kredit · Tanya/diskusi 5 kredit/balasan · Build/iterasi ${fmtNum(generateCost)} kredit bila berhasil`}
              </span>
                <button
                  onClick={() => sendChat.mutate(input.trim())}
                  disabled={tooShort || busy}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy ? "AI Sedang Memproses…" : "Kirim"} <Icon name="arrow" size={15} />
                </button>
            </div>
            {busy && (
              <p className="mt-2 text-xs text-[var(--dim)]">
                AI sedang memproses pesanmu. Pesan build menjalankan pipeline 5 tahap (Planner → Designer → Coder → Builder → Fixer); pesan tanya/diskusi 5 kredit per balasan; balasan yang gagal tidak memotong kredit. Bila build gagal, proyek tidak berubah dan kredit kembali.
              </p>
            )}
          </div>
        </section>

        {/* KANAN — preview di atas, details di bawah (brief UI 2 Nov 2026) */}
        <aside className="flex flex-col gap-4">
          <section className="overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)]">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
              <h2 className="text-[15px] font-bold">Preview</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Mode preview"
                  className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-[var(--border-soft)]"
                >
                  <button
                    type="button"
                    aria-label="Mode HP"
                    aria-pressed={previewMode === "phone"}
                    onClick={() => setPreviewMode("phone")}
                    className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg font-bold ${
                      previewMode === "phone"
                        ? "bg-[#2E6BFF] text-white ring-1 ring-[#2E6BFF]"
                        : "text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    <Icon name="phone" size={20} />
                  </button>
                  <button
                    type="button"
                    aria-label="Mode Desktop"
                    aria-pressed={previewMode === "desktop"}
                    onClick={() => setPreviewMode("desktop")}
                    className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg font-bold ${
                      previewMode === "desktop"
                        ? "bg-[#2E6BFF] text-white ring-1 ring-[#2E6BFF]"
                        : "text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    <Icon name="monitor" size={20} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewModalOpen(true)}
                  className="inline-flex min-h-[44px] items-center rounded-xl bg-gradient-to-r from-[#2E6BFF] to-[#7C4DFF] px-4 text-sm font-bold text-white"
                >
                  Tinjau Preview
                </button>
              </div>
            </div>
            <div className="p-4 sm:p-5">
              {!spec ? (
                <p className="text-sm text-[var(--dim)]">
                  Preview belum tersedia — spesifikasi proyek belum dibuat.
                </p>
              ) : siteFile.isPending ? (
                <p className="text-sm text-[var(--dim)]">Memuat preview…</p>
              ) : siteFile.isError || !siteFile.data?.ok || !siteFile.data.html ? (
                <p className="text-sm text-[var(--dim)]">
                  {siteFile.data?.error ??
                    "Preview belum tersedia — spesifikasi proyek belum dibuat."}
                </p>
              ) : (
                <div
                  className={
                    previewMode === "phone"
                      ? "mx-auto w-full max-w-[390px] overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10"
                      : "overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10"
                  }
                >
                  <SiteFileFrame
                    html={siteFile.data.html}
                    title={`Preview ${project.name}`}
                    heightClass="h-[560px]"
                  />
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
            <h2 className="text-[15px] font-bold">Details</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--dim)]">Nama</dt>
                <dd className="text-right font-bold">{project.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--dim)]">Kategori</dt>
                <dd className="text-right font-bold">{project.category}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--dim)]">Kredit terpakai</dt>
                <dd className="text-right font-bold">
                  {fmtNum(project.creditsCost)} kredit
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--dim)]">Halaman</dt>
                <dd className="text-right font-bold">
                  {spec ? spec.pages.length : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--dim)]">Tabel database</dt>
                <dd className="text-right font-bold">{tables.length}</dd>
              </div>
            </dl>
            {project.plannerMd && (
              <>
                <h3 className="mt-4 text-sm font-bold">Rencana</h3>
                <div className="mt-1.5 max-h-64 overflow-auto rounded-xl bg-[#0A1130] p-3 text-slate-100 ring-1 ring-[var(--border-soft)]">
                  {renderPlannerMd(project.plannerMd)}
                </div>
                <p className="mt-1 text-xs text-[var(--dim)]">
                  Rencana ini disusun dari diskusi chat dan menjadi konteks
                  utama saat build dimulai.
                </p>
              </>
            )}
            {spec && (
              <>
                <h3 className="mt-4 text-sm font-bold">Halaman</h3>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {spec.pages.map((p) => (
                    <li
                      key={p}
                      className="rounded-full bg-white/8 px-2.5 py-1 text-xs font-semibold"
                    >
                      {p}
                    </li>
                  ))}
                </ul>
                <h3 className="mt-4 text-sm font-bold">Fitur</h3>
                <ul className="mt-1.5 space-y-1.5">
                  {spec.features.map((f) => (
                    <li key={f.title} className="text-[13px] leading-relaxed">
                      <span className="font-bold">{f.title}</span>
                      <span className="text-[var(--dim)]"> — {f.description}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {tables.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-bold">
                  Database (skema {tables[0]?.schemaName ?? "—"})
                </h3>
                <ul className="mt-1.5 space-y-1.5">
                  {tables.map((t) => (
                    <li key={t.id} className="text-[13px] leading-relaxed">
                      <span className="font-mono font-bold">{t.name}</span>
                      <span className="text-[var(--dim)]">
                        {" "}
                        ({t.columns.join(", ")})
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {generations.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-bold">Tahap terakhir</h3>
                <ul className="mt-1.5 space-y-1">
                  {generations.slice(-5).map((g) => (
                    <li key={g.id} className="text-[13px] text-[var(--dim)]">
                      {g.stage} · {g.status}
                      {g.credits > 0 ? ` · −${g.credits} kredit` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

        </aside>

        {previewModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Tinjau Preview"
            className="fixed inset-0 z-50 overflow-y-auto"
          >
            <button
              type="button"
              aria-label="Tutup preview"
              onClick={() => setPreviewModalOpen(false)}
              className="fixed inset-0 h-full w-full cursor-default bg-black/70"
            />
            <div className="relative mx-auto my-4 w-[calc(100%-2rem)] max-w-4xl sm:my-8">
              <div className="overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)]">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
                  <h2 className="text-[15px] font-bold">Tinjau Preview</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <div
                      role="group"
                      aria-label="Mode preview"
                      className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-[var(--border-soft)]"
                    >
                      <button
                        type="button"
                        aria-label="Mode HP"
                        aria-pressed={previewMode === "phone"}
                        onClick={() => setPreviewMode("phone")}
                        className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg font-bold ${
                          previewMode === "phone"
                            ? "bg-[#2E6BFF] text-white ring-1 ring-[#2E6BFF]"
                            : "text-slate-200 hover:bg-white/10"
                        }`}
                      >
                        <Icon name="phone" size={20} />
                      </button>
                      <button
                        type="button"
                        aria-label="Mode Desktop"
                        aria-pressed={previewMode === "desktop"}
                        onClick={() => setPreviewMode("desktop")}
                        className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg font-bold ${
                          previewMode === "desktop"
                            ? "bg-[#2E6BFF] text-white ring-1 ring-[#2E6BFF]"
                            : "text-slate-200 hover:bg-white/10"
                        }`}
                      >
                        <Icon name="monitor" size={20} />
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label="Tutup preview"
                      onClick={() => setPreviewModalOpen(false)}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-white/8 font-bold hover:bg-white/12"
                    >
                      <Icon name="x" size={20} />
                    </button>
                  </div>
                </div>
                <div className="p-4 sm:p-5">
                  {!spec ? (
                    <p className="text-sm text-[var(--dim)]">
                      Preview belum tersedia — spesifikasi proyek belum dibuat.
                    </p>
                  ) : siteFile.isPending ? (
                    <p className="text-sm text-[var(--dim)]">Memuat preview…</p>
                  ) : siteFile.isError || !siteFile.data?.ok || !siteFile.data.html ? (
                    <p className="text-sm text-[var(--dim)]">
                      {siteFile.data?.error ??
                        "Preview belum tersedia — spesifikasi proyek belum dibuat."}
                    </p>
                  ) : (
                    <div
                      className={
                        previewMode === "phone"
                          ? "mx-auto w-full max-w-[390px] overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10"
                          : "overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10"
                      }
                    >
                      <SiteFileFrame
                        html={siteFile.data.html}
                        title={`Tinjau Preview ${project.name}`}
                        heightClass="h-[70vh]"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
