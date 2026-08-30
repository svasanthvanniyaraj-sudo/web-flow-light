/**
 * EcoConnect page logic.
 *
 * This is the original single-page script, with the in-memory demo "database"
 * replaced by Lovable Cloud (database + media storage) and mobile OTP sign-in.
 * The markup lives in ./ecoconnect.html and the styles in ./ecoconnect.css.
 */
import { supabase } from "@/integrations/supabase/client";

type ReportRow = {
  id: string;
  ref_code: string;
  reporter_name: string;
  reporter_mobile: string | null;
  category: string;
  other_text: string | null;
  area: string;
  description: string;
  loc_name: string;
  full_address: string | null;
  lat: number | null;
  lon: number | null;
  photo_url: string | null;
  video_url: string | null;
  status: string;
  created_at: string;
};

const MAX_REC_SECONDS = 120;
const REPORT_PAGE_SIZE = 30;

const urbanAreas = [
  "Virudhunagar (Corporation)",
  "Sivakasi",
  "Aruppukkottai",
  "Rajapalayam",
  "Sattur",
  "Srivilliputhur",
];
const ruralAreas = [
  "Kariapatti",
  "Tiruchuli",
  "Vembakottai",
  "Watrap",
  "Seithur",
  "Chettiarpatti",
  "Mallankinaru",
  "Sundarapandiam",
  "S.Kodikulam",
  "V.Pudupatti",
  "Mamsapuram",
  "Vathirairuppu",
  "Narikkudi",
  "Sokkankottai",
];

const catBadge: Record<string, [string, string]> = {
  water: ["💧 Water", "badge-water"],
  air: ["🌬️ Air", "badge-air"],
  land: ["🌱 Land", "badge-land"],
  wire: ["⚡ Wire", "badge-wire"],
  others: ["🔧 Others", "badge-others"],
};

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** Signed media URLs are cached so scrolling the feed doesn't re-request them. */
const mediaUrlCache = new Map<string, string>();

async function signedMediaUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const cached = mediaUrlCache.get(path);
  if (cached) return cached;
  const { data } = await supabase.storage.from("evidence").createSignedUrl(path, 60 * 60);
  if (!data?.signedUrl) return null;
  mediaUrlCache.set(path, data.signedUrl);
  return data.signedUrl;
}

export function initEcoConnect(): () => void {
  const cleanups: Array<() => void> = [];

  const state: {
    profile: { name: string; mobile: string } | null;
    userId: string | null;
    reports: ReportRow[];
    photoBlob: Blob | null;
    videoBlob: Blob | null;
    photoPreview: string | null;
    videoPreview: string | null;
    detectedLocation: { lat: number; lon: number; name: string } | null;
    reportLocationPinned: boolean;
    pendingMobile: string | null;
    pendingName: string | null;
    submitting: boolean;
  } = {
    profile: null,
    userId: null,
    reports: [],
    photoBlob: null,
    videoBlob: null,
    photoPreview: null,
    videoPreview: null,
    detectedLocation: null,
    reportLocationPinned: false,
    pendingMobile: null,
    pendingName: null,
    submitting: false,
  };

  /* ---------------- toast ---------------- */
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(icon: string, title: string, msg: string, ms = 4200) {
    const iconEl = el("toastIcon");
    const titleEl = el("toastTitle");
    const msgEl = el("toastMsg");
    const t = el("toast");
    if (!iconEl || !titleEl || !msgEl || !t) return;
    iconEl.textContent = icon;
    titleEl.textContent = title;
    msgEl.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  /* ---------------- intro splash ---------------- */
  document.body.classList.add("intro-lock");
  const introTimers: Array<ReturnType<typeof setTimeout>> = [];
  (function bootIntro() {
    const source = document.querySelector(".beam-svg");
    const host = el("introSvgHost");
    if (source && host) {
      const clone = source.cloneNode(true) as SVGElement;
      clone.removeAttribute("class");
      const idMap: Record<string, string> = {};
      clone.querySelectorAll("[id]").forEach((node) => {
        const newId = node.id + "-intro";
        idMap[node.id] = newId;
        node.id = newId;
      });
      clone.querySelectorAll("*").forEach((node) => {
        ["fill", "stroke", "clip-path"].forEach((attr) => {
          const val = node.getAttribute(attr);
          if (val && val.includes("url(#")) {
            node.setAttribute(
              attr,
              val.replace(/url\(#([^)]+)\)/, (m, id: string) =>
                idMap[id] ? `url(#${idMap[id]})` : m,
              ),
            );
          }
        });
        const href = node.getAttribute("href");
        if (href && href.startsWith("#") && idMap[href.slice(1)]) {
          node.setAttribute("href", "#" + idMap[href.slice(1)]);
        }
      });
      host.appendChild(clone);
    }
    introTimers.push(
      setTimeout(() => {
        const splash = el("introSplash");
        document.body.classList.remove("intro-lock");
        if (!splash) return;
        splash.classList.add("hide");
        introTimers.push(setTimeout(() => (splash.style.display = "none"), 750));
      }, 3300),
    );
  })();
  cleanups.push(() => {
    introTimers.forEach(clearTimeout);
    document.body.classList.remove("intro-lock");
  });

  /* ---------------- area lists ---------------- */
  const renderAreaList = (id: string, arr: string[]) => {
    const node = el(id);
    if (node) node.innerHTML = arr.map((a) => `<div class="area-item">${a}</div>`).join("");
  };
  renderAreaList("urban-list", urbanAreas);
  renderAreaList("rural-list", ruralAreas);

  const urbanGroup = el("areaUrbanGroup");
  const ruralGroup = el("areaRuralGroup");
  if (urbanGroup)
    urbanGroup.innerHTML = urbanAreas.map((a) => `<option value="${a}">${a}</option>`).join("");
  if (ruralGroup)
    ruralGroup.innerHTML = ruralAreas.map((a) => `<option value="${a}">${a}</option>`).join("");

  function showAreaTab(which: string, ev?: Event) {
    document.querySelectorAll(".area-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".area-list").forEach((t) => t.classList.remove("active"));
    (ev?.target as HTMLElement | undefined)?.classList.add("active");
    el(which + "-list")?.classList.add("active");
  }

  /* ---------------- location ---------------- */
  function reverseGeocode(lat: number, lon: number): Promise<string> {
    return fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14`,
    )
      .then((r) => r.json())
      .then((d) => {
        const a = d.address || {};
        return (
          a.village ||
          a.town ||
          a.suburb ||
          a.county ||
          a.state_district ||
          a.city ||
          d.display_name ||
          `${lat.toFixed(3)}, ${lon.toFixed(3)}`
        );
      })
      .catch(() => `${lat.toFixed(3)}, ${lon.toFixed(3)}`);
  }

  (function initHeaderLocation() {
    const pill = el("headerLocation");
    if (!pill) return;
    if (!navigator.geolocation) {
      pill.textContent = "📍 Location unavailable";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const name = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        pill.textContent = "📍 " + name;
        state.detectedLocation = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          name,
        };
      },
      () => {
        pill.textContent = "📍 Location access denied";
      },
      { timeout: 8000 },
    );
  })();

  function detectLocation() {
    const box = el("locBox");
    if (!box) return;
    if (!navigator.geolocation) {
      box.textContent = "Geolocation not supported on this device — location pin is required.";
      return;
    }
    box.textContent = "Detecting your location…";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const name = await reverseGeocode(lat, lon);
        state.detectedLocation = { lat, lon, name };
        state.reportLocationPinned = true;
        box.textContent = `📍 ${name} (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
        const locName = el<HTMLInputElement>("locName");
        if (locName) locName.value = name;
      },
      () => {
        state.reportLocationPinned = false;
        box.textContent =
          '🚫 Location permission denied — please allow location access and tap "Use My Current Location" again. This step is required to submit.';
      },
    );
  }

  /* ---------------- steps + sign in ---------------- */
  function goStep(n: number) {
    if (n > 1 && !state.profile) {
      showToast("⚠️", "Sign in required", "Please verify your mobile number with OTP first.");
      n = 1;
    }
    for (let i = 1; i <= 3; i++) {
      el("panel" + i)?.classList.toggle("active", i === n);
      el("tab" + i)?.classList.toggle("active", i === n);
    }
  }

  // Demo mode: SMS provider is not configured yet, so a random OTP is generated per request.
  const generateOtp = () => {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return String(100000 + ((bytes[0] ?? 0) % 900000));
  };
  let currentOtp = "";
  const demoEmail = (mobile: string) => `user${mobile}@ecoconnect.demo`;
  const demoPassword = (mobile: string) => `EcoConnect#${mobile}`;


  async function sendOtp() {
    const name = el<HTMLInputElement>("userName")?.value.trim() ?? "";
    const mobile = el<HTMLInputElement>("userMobile")?.value.trim() ?? "";
    if (!name) {
      showToast("⚠️", "Name required", "Please enter your name.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      showToast("⚠️", "Check mobile number", "Enter a valid 10-digit mobile number.");
      return;
    }
    const btn = el<HTMLButtonElement>("sendOtpBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Sending OTP…";
    }
    await new Promise((r) => setTimeout(r, 400));
    if (btn) {
      btn.disabled = false;
      btn.textContent = "📲 Send OTP";
    }
    currentOtp = generateOtp();
    state.pendingMobile = mobile;
    state.pendingName = name;
    const otpField = el("otpField");
    const otpActions = el("otpActions");
    if (otpField) otpField.style.display = "grid";
    if (otpActions) otpActions.style.display = "flex";
    const input = el<HTMLInputElement>("otpInput");
    if (input) input.value = "";
    const hint = el("otpHint");
    if (hint)
      hint.textContent = `Demo mode: SMS is not enabled yet. Your OTP is ${currentOtp} for +91 ${mobile}.`;
    showToast("📲", "Your OTP", `Use ${currentOtp} to verify ${mobile}.`);
  }

  async function verifyOtp() {
    const entered = el<HTMLInputElement>("otpInput")?.value.trim() ?? "";
    if (!state.pendingMobile) {
      showToast("⚠️", "Send OTP first", 'Tap "Send OTP" before verifying.');
      return;
    }
    if (!currentOtp || entered !== currentOtp) {
      showToast("🚫", "Incorrect OTP", "The OTP you entered is wrong. Please try again.");
      return;
    }
    const email = demoEmail(state.pendingMobile);
    const password = demoPassword(state.pendingMobile);
    let { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const signUp = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: state.pendingName ?? "Citizen", mobile: state.pendingMobile } },
      });
      if (signUp.error || !signUp.data.user) {
        showToast("🚫", "Sign in failed", signUp.error?.message ?? "Please try again.");
        return;
      }
      if (!signUp.data.session) {
        const retry = await supabase.auth.signInWithPassword({ email, password });
        if (retry.error || !retry.data.user) {
          showToast("🚫", "Sign in failed", retry.error?.message ?? "Please try again.");
          return;
        }
        data = retry.data;
      } else {
        data = { user: signUp.data.user, session: signUp.data.session };
      }
    }
    if (!data?.user) {
      showToast("🚫", "Sign in failed", "Please try again.");
      return;
    }
    state.userId = data.user.id;
    state.profile = { name: state.pendingName ?? "Citizen", mobile: state.pendingMobile };
    await supabase.auth.updateUser({ data: { full_name: state.profile.name } });
    showToast("✅", "Signed in", `Welcome, ${state.profile.name}!`);
    goStep(2);
  }

  /* ---------------- camera facing ---------------- */
  let facingMode: "user" | "environment" = "environment";
  const videoConstraint = () => ({ facingMode: { ideal: facingMode } });
  const facingLabel = () => (facingMode === "environment" ? "Back" : "Front");

  /* ---------------- photo capture ---------------- */
  let camStream: MediaStream | null = null;
  function camControlsMarkup() {
    return `<button class="btn btn-primary btn-sm" onclick="takePhoto()">📸 Capture</button>
       <button class="btn btn-outline btn-sm" onclick="switchCamera()">🔄 ${facingLabel()} cam</button>
       <button class="btn btn-ghost btn-sm" onclick="closeCamera()">Close</button>`;
  }

  async function openCamera() {
    try {
      camStream?.getTracks().forEach((t) => t.stop());
      camStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint() });
      const v = el<HTMLVideoElement>("camVideo");
      if (v) {
        v.srcObject = camStream;
        v.style.display = "block";
      }
      const controls = el("camControls");
      if (controls) controls.innerHTML = camControlsMarkup();
    } catch {
      showToast(
        "🚫",
        "Camera unavailable",
        "Allow camera access, and open this page over HTTPS or localhost.",
      );
    }
  }

  async function switchCamera() {
    facingMode = facingMode === "environment" ? "user" : "environment";
    if (camStream) await openCamera();
    if (qrStream && (!qrRecorder || qrRecorder.state === "inactive")) await restartQuickRecordStream();
    showToast("🔄", "Camera switched", `Now using the ${facingLabel().toLowerCase()} camera.`);
  }


  function takePhoto() {
    const v = el<HTMLVideoElement>("camVideo");
    const c = el<HTMLCanvasElement>("camCanvas");
    if (!v || !c) return;
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 480;
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        if (state.photoPreview) URL.revokeObjectURL(state.photoPreview);
        state.photoBlob = blob;
        state.photoPreview = URL.createObjectURL(blob);
        const thumbs = el("photoThumbs");
        if (thumbs)
          thumbs.innerHTML = `<img class="thumb" src="${state.photoPreview}" alt="Captured photo">`;
        showToast("📷", "Photo captured", "Your photo has been attached to this report.");
        closeCamera();
      },
      "image/jpeg",
      0.8,
    );
  }

  function closeCamera() {
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = null;
    const v = el<HTMLVideoElement>("camVideo");
    if (v) v.style.display = "none";
    const controls = el("camControls");
    if (controls)
      controls.innerHTML = `<button class="btn btn-outline btn-sm" onclick="openCamera()">Open Camera</button>`;
  }

  /* ---------------- video capture ---------------- */
  let mediaRecorder: MediaRecorder | null = null;
  let recChunks: Blob[] = [];
  let recStream: MediaStream | null = null;
  let recSeconds = 0;
  let recTimerInterval: ReturnType<typeof setInterval> | undefined;

  function updateRecTimer() {
    const mm = String(Math.floor(recSeconds / 60)).padStart(2, "0");
    const ss = String(recSeconds % 60).padStart(2, "0");
    const t = el("recTimer");
    if (t) t.textContent = `${mm}:${ss} / 02:00`;
  }

  function attachVideo(blob: Blob, seconds: number, thumbId: string) {
    if (state.videoPreview) URL.revokeObjectURL(state.videoPreview);
    state.videoBlob = blob;
    state.videoPreview = URL.createObjectURL(blob);
    const thumbs = el(thumbId);
    if (thumbs)
      thumbs.innerHTML = `<video class="thumb" src="${state.videoPreview}" controls muted></video>`;
    showToast("🎬", "Clip saved", `${seconds}-second video attached to this report.`);
  }

  async function startVideoRecording() {
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const v = el<HTMLVideoElement>("vidPreview");
      if (v) {
        v.srcObject = recStream;
        v.style.display = "block";
      }
      recChunks = [];
      mediaRecorder = new MediaRecorder(recStream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recChunks.push(e.data);
      };
      mediaRecorder.onstop = () =>
        attachVideo(new Blob(recChunks, { type: "video/webm" }), recSeconds, "videoThumbs");
      mediaRecorder.start();

      recSeconds = 0;
      const timer = el("recTimer");
      if (timer) timer.style.display = "block";
      const stopBtn = el("stopRecBtn");
      if (stopBtn) stopBtn.style.display = "inline-flex";
      const firstBtn = el("vidControls")?.querySelector("button") as HTMLElement | null;
      if (firstBtn) firstBtn.style.display = "none";
      updateRecTimer();
      recTimerInterval = setInterval(() => {
        recSeconds++;
        updateRecTimer();
        if (recSeconds >= MAX_REC_SECONDS) stopVideoRecording();
      }, 1000);
    } catch {
      showToast(
        "🚫",
        "Camera/mic unavailable",
        "Allow camera & microphone access, and open this page over HTTPS or localhost.",
      );
    }
  }

  function stopVideoRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    recStream?.getTracks().forEach((t) => t.stop());
    clearInterval(recTimerInterval);
    const v = el<HTMLVideoElement>("vidPreview");
    if (v) v.style.display = "none";
    const stopBtn = el("stopRecBtn");
    if (stopBtn) stopBtn.style.display = "none";
    const firstBtn = el("vidControls")?.querySelector("button") as HTMLElement | null;
    if (firstBtn) firstBtn.style.display = "inline-flex";
    const timer = el("recTimer");
    if (timer) timer.style.display = "none";
  }

  /* ---------------- quick record overlay ---------------- */
  let qrStream: MediaStream | null = null;
  let qrRecorder: MediaRecorder | null = null;
  let qrChunks: Blob[] = [];
  let qrSeconds = 0;
  let qrInterval: ReturnType<typeof setInterval> | undefined;

  async function openQuickRecord() {
    const overlay = el("qrOverlay");
    if (overlay) overlay.classList.add("show");
    try {
      qrStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const v = el<HTMLVideoElement>("qrVideo");
      if (v) v.srcObject = qrStream;
    } catch {
      showToast("🚫", "Camera unavailable", "Allow camera & microphone access to record a clip.");
      closeQuickRecord();
    }
  }

  function closeQuickRecord() {
    if (qrRecorder && qrRecorder.state !== "inactive") qrRecorder.stop();
    clearInterval(qrInterval);
    qrStream?.getTracks().forEach((t) => t.stop());
    qrStream = null;
    const overlay = el("qrOverlay");
    if (overlay) overlay.classList.remove("show");
    const startBtn = el("qrStartBtn");
    const stopBtn = el("qrStopBtn");
    const timer = el("qrTimer");
    if (startBtn) startBtn.style.display = "inline-flex";
    if (stopBtn) stopBtn.style.display = "none";
    if (timer) timer.style.display = "none";
  }

  function qrStart() {
    if (!qrStream) return;
    qrChunks = [];
    qrRecorder = new MediaRecorder(qrStream);
    qrRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) qrChunks.push(e.data);
    };
    qrRecorder.onstop = () =>
      attachVideo(new Blob(qrChunks, { type: "video/webm" }), qrSeconds, "videoThumbs");
    qrRecorder.start();
    qrSeconds = 0;
    const timer = el("qrTimer");
    if (timer) {
      timer.style.display = "block";
      timer.textContent = "00:00 / 02:00";
    }
    const startBtn = el("qrStartBtn");
    const stopBtn = el("qrStopBtn");
    if (startBtn) startBtn.style.display = "none";
    if (stopBtn) stopBtn.style.display = "inline-flex";
    qrInterval = setInterval(() => {
      qrSeconds++;
      const mm = String(Math.floor(qrSeconds / 60)).padStart(2, "0");
      const ss = String(qrSeconds % 60).padStart(2, "0");
      if (timer) timer.textContent = `${mm}:${ss} / 02:00`;
      if (qrSeconds >= MAX_REC_SECONDS) qrStop();
    }, 1000);
  }

  function qrStop() {
    if (qrRecorder && qrRecorder.state !== "inactive") qrRecorder.stop();
    clearInterval(qrInterval);
    closeQuickRecord();
  }

  /* ---------------- reports: load / render ---------------- */
  async function loadReports() {
    const [{ data, error }, counts] = await Promise.all([
      supabase
        .from("reports")
        .select(
          "id, ref_code, reporter_name, reporter_mobile, category, other_text, area, description, loc_name, full_address, lat, lon, photo_url, video_url, status, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(REPORT_PAGE_SIZE),
      loadCounts(),
    ]);
    if (error) {
      showToast("🚫", "Could not load reports", error.message);
      return;
    }
    state.reports = (data ?? []) as ReportRow[];
    applyCounts(counts);
    await renderPublicReports();
    await renderAdminTable();
  }

  async function loadCounts() {
    const [total, resolved, reporters] = await Promise.all([
      supabase.from("reports").select("id", { count: "exact", head: true }),
      supabase
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("status", "resolved"),
      supabase.from("reports").select("reporter_mobile").limit(1000),
    ]);
    const uniqueUsers = new Set(
      (reporters.data ?? []).map((r) => (r as { reporter_mobile: string | null }).reporter_mobile),
    ).size;
    return {
      total: total.count ?? 0,
      resolved: resolved.count ?? 0,
      users: uniqueUsers,
    };
  }

  function applyCounts(counts: { total: number; resolved: number; users: number }) {
    const set = (id: string, value: number) => {
      const node = el(id);
      if (node) node.textContent = String(value);
    };
    set("statUsers", counts.users);
    set("statReports", counts.total);
    set("bUsers", counts.users);
    set("bReports", counts.total);
    set("bResolved", counts.resolved);
  }

  function categoryLabel(r: ReportRow): [string, string] {
    const [label, cls] = catBadge[r.category] ?? catBadge["others"]!;
    if (r.category === "others" && r.other_text) return ["🔧 " + escapeHtml(r.other_text), cls];
    return [label, cls];
  }

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  async function mediaHtml(r: ReportRow, cls: string) {
    const photo = await signedMediaUrl(r.photo_url);
    if (photo) return `<img class="${cls}" loading="lazy" src="${photo}" alt="Report evidence">`;
    const video = await signedMediaUrl(r.video_url);
    if (video) return `<video class="${cls}" src="${video}" controls muted preload="none"></video>`;
    return "";
  }

  async function renderPublicReports() {
    const wrap = el("publicReportsWrap");
    if (!wrap) return;
    if (!state.reports.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="ic">🗂️</div>No reports submitted yet. New reports will appear here instantly.</div>`;
      return;
    }
    const cards = await Promise.all(
      state.reports.map(async (r) => {
        const [catLabel, catClass] = categoryLabel(r);
        const media = await mediaHtml(r, "public-report-media");
        const statusBadge =
          r.status === "resolved"
            ? `<span class="badge badge-resolved">✅ Resolved</span>`
            : `<span class="badge badge-pending">⏳ Pending</span>`;
        const coords =
          r.lat != null && r.lon != null ? ` (${r.lat.toFixed(4)}, ${r.lon.toFixed(4)})` : "";
        return `<div class="public-report-card">
      ${media}
      <div class="public-report-loc">📍 ${escapeHtml(r.loc_name)}${coords}</div>
      <div class="public-report-body">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span class="badge ${catClass}">${catLabel}</span>
          ${statusBadge}
        </div>
        <p style="margin:8px 0 4px;font-size:13.5px;color:var(--navy-2);">${escapeHtml(r.description)}</p>
        <div style="font-size:12px;color:var(--muted);">${escapeHtml(r.area)}${
          r.full_address ? " · " + escapeHtml(r.full_address) : ""
        }<br>${formatTime(r.created_at)}</div>
      </div>
    </div>`;
      }),
    );
    wrap.innerHTML = `<div class="public-reports-grid">${cards.join("")}</div>`;
  }

  async function renderAdminTable() {
    const wrap = el("reportTableWrap");
    if (!wrap) return;
    if (!state.reports.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="ic">🗂️</div>No reports submitted yet. New reports will appear here instantly.</div>`;
      return;
    }
    const rows = await Promise.all(
      state.reports.map(async (r) => {
        const [catLabel, catClass] = categoryLabel(r);
        const evidence = await mediaHtml(r, "rt-thumb");
        const statusBadge =
          r.status === "resolved"
            ? `<span class="badge badge-resolved">✅ Resolved</span>`
            : `<span class="badge badge-pending">⏳ Pending</span>`;
        const actionBtn =
          r.status === "resolved"
            ? "—"
            : `<button class="btn btn-primary btn-sm" onclick="resolveReport('${r.id}')">Mark Resolved</button>`;
        return `<tr>
      <td><b>${escapeHtml(r.ref_code)}</b><br><span style="color:var(--muted);font-size:12px;">${formatTime(
        r.created_at,
      )}</span></td>
      <td>${escapeHtml(r.reporter_name)}<br><span style="color:var(--muted);font-size:12px;">${escapeHtml(
        r.reporter_mobile ?? "",
      )}</span></td>
      <td><span class="badge ${catClass}">${catLabel}</span></td>
      <td>${escapeHtml(r.loc_name)}<br><span style="color:var(--muted);font-size:12px;">${escapeHtml(
        r.area,
      )}${r.full_address ? " · " + escapeHtml(r.full_address) : ""}</span></td>
      <td style="display:flex;gap:6px;">${evidence}</td>
      <td>${statusBadge}</td>
      <td>${actionBtn}</td>
    </tr>`;
      }),
    );
    wrap.innerHTML = `<div style="overflow-x:auto;"><table class="report-table">
    <thead><tr><th>Report</th><th>Reported By</th><th>Category</th><th>Location</th><th>Evidence</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>`;
  }

  /* ---------------- submit ---------------- */
  async function uploadEvidence(blob: Blob, ext: string, contentType: string) {
    const path = `${state.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("evidence")
      .upload(path, blob, { contentType, cacheControl: "3600" });
    if (error) throw error;
    return path;
  }

  async function submitReport() {
    if (state.submitting) return;
    const category = el<HTMLSelectElement>("issueCategory")?.value ?? "";
    const area = el<HTMLSelectElement>("areaName")?.value.trim() ?? "";
    const desc = el<HTMLTextAreaElement>("issueDesc")?.value.trim() ?? "";
    const locName = el<HTMLInputElement>("locName")?.value.trim() ?? "";
    const otherText = el<HTMLInputElement>("otherCategoryText")?.value.trim() ?? "";
    const fullAddress = el<HTMLTextAreaElement>("fullAddress")?.value.trim() ?? "";

    if (!state.profile || !state.userId) {
      showToast("⚠️", "Sign in required", "Verify your mobile number with OTP first.");
      goStep(1);
      return;
    }
    if (!area || !desc) {
      showToast("⚠️", "Missing details", "Please fill in the area name and description.");
      return;
    }
    if (category === "others" && !otherText) {
      showToast("⚠️", "Specify the issue", "Please tell us what kind of issue this is.");
      return;
    }
    if (!state.photoBlob && !state.videoBlob) {
      showToast("⚠️", "Add evidence", "Please capture at least a photo or a video.");
      return;
    }
    if (!state.reportLocationPinned) {
      showToast(
        "📍",
        "Location pin required",
        'You must tap "Use My Current Location" to pin your location before submitting.',
      );
      return;
    }
    if (!locName) {
      showToast("⚠️", "Location needed", "Please detect the location.");
      return;
    }

    state.submitting = true;
    try {
      const photoPath = state.photoBlob
        ? await uploadEvidence(state.photoBlob, "jpg", "image/jpeg")
        : null;
      const videoPath = state.videoBlob
        ? await uploadEvidence(state.videoBlob, "webm", "video/webm")
        : null;

      const refCode = "EC" + Date.now().toString().slice(-6);
      const { error } = await supabase.from("reports").insert({
        ref_code: refCode,
        user_id: state.userId,
        reporter_name: state.profile.name,
        reporter_mobile: state.profile.mobile,
        category,
        other_text: otherText || null,
        area,
        description: desc,
        loc_name: locName,
        full_address: fullAddress || null,
        lat: state.detectedLocation?.lat ?? null,
        lon: state.detectedLocation?.lon ?? null,
        photo_url: photoPath,
        video_url: videoPath,
      });
      if (error) throw error;

      showToast("✅", "Report submitted!", `Report #${refCode} has been saved to the database.`);

      const clear = (id: string) => {
        const node = el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id);
        if (node) node.value = "";
      };
      ["issueDesc", "otherCategoryText", "areaName", "locName", "fullAddress"].forEach(clear);
      const otherField = el("otherCategoryField");
      if (otherField) otherField.style.display = "none";
      const box = el("locBox");
      if (box) box.textContent = "Location not detected yet — this step is required to submit.";
      const photoThumbs = el("photoThumbs");
      const videoThumbs = el("videoThumbs");
      if (photoThumbs) photoThumbs.innerHTML = "";
      if (videoThumbs) videoThumbs.innerHTML = "";
      if (state.photoPreview) URL.revokeObjectURL(state.photoPreview);
      if (state.videoPreview) URL.revokeObjectURL(state.videoPreview);
      state.photoBlob = null;
      state.videoBlob = null;
      state.photoPreview = null;
      state.videoPreview = null;
      state.reportLocationPinned = false;

      await loadReports();
      goStep(2);
    } catch (err) {
      showToast("🚫", "Submit failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      state.submitting = false;
    }
  }

  /* ---------------- admin ---------------- */
  async function adminLogin() {
    if (!state.userId) {
      showToast(
        "🔐",
        "Verify your mobile first",
        "Sign in with your mobile number in the Report section to open the dashboard.",
      );
      return;
    }
    const loginView = el("adminLoginView");
    const dashView = el("adminDashView");
    const label = el("adminNameLabel");
    if (loginView) loginView.style.display = "none";
    if (dashView) dashView.style.display = "block";
    if (label) label.textContent = state.profile?.name ?? "Signed-in user";
    await loadReports();
  }

  function adminLogout() {
    const loginView = el("adminLoginView");
    const dashView = el("adminDashView");
    if (loginView) loginView.style.display = "block";
    if (dashView) dashView.style.display = "none";
  }

  async function resolveReport(id: string) {
    const { error } = await supabase.from("reports").update({ status: "resolved" }).eq("id", id);
    if (error) {
      showToast("🚫", "Could not update", error.message);
      return;
    }
    showToast("📩", "Marked resolved", "The report status has been updated for everyone.");
    await loadReports();
  }

  function toggleOtherCategory() {
    const isOther = el<HTMLSelectElement>("issueCategory")?.value === "others";
    const field = el("otherCategoryField");
    if (field) field.style.display = isOther ? "block" : "none";
  }

  /* ---------------- restore session + expose handlers ---------------- */
  void (async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user) {
      state.userId = user.id;
      const mobile = (user.phone ?? "").replace(/^\+?91/, "");
      state.profile = {
        name: (user.user_metadata?.["full_name"] as string) ?? "Citizen",
        mobile,
      };
    }
    await loadReports();
  })();

  const handlers: Record<string, (...args: never[]) => unknown> = {
    showAreaTab,
    goStep,
    sendOtp,
    verifyOtp,
    openCamera,
    takePhoto,
    closeCamera,
    startVideoRecording,
    stopVideoRecording,
    openQuickRecord,
    closeQuickRecord,
    qrStart,
    qrStop,
    detectLocation,
    submitReport,
    adminLogin,
    adminLogout,
    resolveReport,
    toggleOtherCategory,
  };
  const w = window as unknown as Record<string, unknown>;
  Object.entries(handlers).forEach(([name, fn]) => {
    w[name] = name === "showAreaTab" ? (which: string) => showAreaTab(which, window.event) : fn;
  });
  cleanups.push(() => Object.keys(handlers).forEach((name) => delete w[name]));

  cleanups.push(() => {
    closeCamera();
    stopVideoRecording();
    closeQuickRecord();
    clearTimeout(toastTimer);
  });

  return () => cleanups.forEach((fn) => fn());
}
