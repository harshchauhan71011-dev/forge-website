import { AGE, BYTES, CONTRIBUTORS, LOC, PR_BUCKETS, estimate } from "./estimator.js";

const $ = (s, r = document) => r.querySelector(s);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- site chrome (same behaviour as the homepage) ---------- */
document.documentElement.classList.add("has-js");
const menu = $(".menu-toggle"), nav = $("#navigation");
menu.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  nav.classList.toggle("is-open", open);
  menu.textContent = open ? "Close" : "Menu";
});
nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => { menu.setAttribute("aria-expanded", "false"); nav.classList.remove("is-open"); menu.textContent = "Menu"; }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu.getAttribute("aria-expanded") === "true") { menu.click(); menu.focus(); } });

/* Entrances: content is visible without script; with script it rises in once. */
const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" }) : null;
document.querySelectorAll("[data-reveal]").forEach((el, i) => { el.style.transitionDelay = `${(Number(el.dataset.reveal) || 0) * 80}ms`; io ? io.observe(el) : el.classList.add("in"); });

/* The film plays only while on screen; poster only under reduced motion. */
const film = $("#film");
if (film && !reduceMotion && "IntersectionObserver" in window) {
  new IntersectionObserver(([e]) => (e.isIntersecting ? film.play().catch(() => {}) : film.pause()), { threshold: 0.25 }).observe(film);
}

/* ---------- the estimator ---------- */
const state = { language: "TypeScript", prMode: "exact", prCount: "", prBucket: "50-200", age: "2-4", contributors: "2-3", unit: "loc", size: "10k-100k" };
let shown = false;

function buildSlider(id, options, key) {
  const input = $(`#${id}`), value = $(`#${id}-value`), ticks = $(`#${id}-ticks`);
  const render = () => {
    const i = Math.max(0, options.findIndex((o) => o.value === state[key]));
    input.max = String(options.length - 1);
    input.value = String(i);
    input.setAttribute("aria-valuetext", options[i].label);
    value.textContent = options[i].label;
    ticks.innerHTML = options.map((o, j) => `<span class="${j === i ? "on" : ""}">${o.short}</span>`).join("");
  };
  input.addEventListener("input", () => { state[key] = options[Number(input.value)].value; render(); changed(); });
  render();
  return render;
}

const renderAge = buildSlider("age", AGE, "age");
const renderTeam = buildSlider("team", CONTRIBUTORS, "contributors");
let sizeOptions = LOC;
const renderSize = (() => {
  const input = $("#size"), value = $("#size-value"), ticks = $("#size-ticks"), label = $("#size-label");
  const render = () => {
    sizeOptions = state.unit === "loc" ? LOC : BYTES;
    const i = Math.max(0, sizeOptions.findIndex((o) => o.value === state.size));
    input.max = String(sizeOptions.length - 1);
    input.value = String(i);
    input.setAttribute("aria-valuetext", sizeOptions[i].label);
    value.textContent = sizeOptions[i].label;
    label.textContent = state.unit === "loc" ? "Lines of code" : "Size on GitHub";
    ticks.innerHTML = sizeOptions.map((o, j) => `<span class="${j === i ? "on" : ""}">${o.short}</span>`).join("");
  };
  input.addEventListener("input", () => { state.size = sizeOptions[Number(input.value)].value; render(); changed(); });
  return render;
})();
renderSize();

document.querySelectorAll(".unit-toggle button").forEach((b) => b.addEventListener("click", () => {
  if (state.unit === b.dataset.unit) return;
  state.unit = b.dataset.unit;
  state.size = state.unit === "loc" ? "10k-100k" : "lt50mb";
  document.querySelectorAll(".unit-toggle button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderSize();
  changed();
}));

$("#language").addEventListener("change", (e) => { state.language = e.target.value; changed(); });
$("#pr").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 7); state.prCount = e.target.value; changed(); });
$("#pr-bucket").addEventListener("change", (e) => { state.prBucket = e.target.value; changed(); });

function setPrMode(mode) {
  state.prMode = mode;
  $("#pr-exact").hidden = mode !== "exact";
  $("#pr-range").hidden = mode !== "bucket";
  changed();
}
$("#to-range").addEventListener("click", () => setPrMode("bucket"));
$("#to-exact").addEventListener("click", () => setPrMode("exact"));
$("#show-where").addEventListener("click", (e) => {
  const where = $("#where");
  where.hidden = !where.hidden;
  e.currentTarget.setAttribute("aria-expanded", String(!where.hidden));
  e.currentTarget.textContent = where.hidden ? "Show me where" : "Hide example";
});
$("#copy-link").addEventListener("click", async (e) => {
  try { await navigator.clipboard.writeText("https://github.com/<owner>/<repo>/pulls?q=is%3Apr+is%3Amerged"); e.currentTarget.textContent = "Copied"; } catch { e.currentTarget.textContent = "Copy failed"; }
  setTimeout(() => (e.currentTarget.textContent = "Copy link"), 1500);
});

function input() {
  const pr = state.prMode === "exact" ? { mode: "exact", count: Number(state.prCount) } : { mode: "bucket", bucket: state.prBucket };
  return { language: state.language, pr, age: state.age, contributors: state.contributors, size: { unit: state.unit, bucket: state.size } };
}
const needsPr = () => state.prMode === "exact" && state.prCount === "";

/* Count from the figure on screen to the new one; always land on the real value. */
let tween = null;
function animateRange(lo, hi) {
  const textEl = $("#ingot-figure");
  const [fromLo, fromHi] = (textEl.dataset.v || `${lo},${hi}`).split(",").map(Number);
  textEl.dataset.v = `${lo},${hi}`;
  cancelAnimationFrame(tween);
  const set = (a, b) => (textEl.textContent = `$${a}–$${b}`);
  if (reduceMotion) return set(lo, hi);
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 450), e = 1 - Math.pow(1 - k, 3);
    set(Math.round(fromLo + (lo - fromLo) * e), Math.round(fromHi + (hi - fromHi) * e));
    if (k < 1) tween = requestAnimationFrame(step);
  };
  tween = requestAnimationFrame(step);
  setTimeout(() => set(lo, hi), 530);
}

function render() {
  if (needsPr()) { $("#ingot").classList.add("dim"); $("#stale").hidden = false; return; }
  $("#ingot").classList.remove("dim");
  $("#stale").hidden = true;
  const r = estimate(input());
  const priced = r.low !== null;
  const ingot = $("#ingot");
  ingot.classList.remove("strike"); void ingot.offsetWidth; ingot.classList.add("strike");
  if (priced) animateRange(r.low, r.high); else { $("#ingot-figure").textContent = "Not this time"; $("#ingot-figure").dataset.v = ""; }
  $("#ingot-sub").textContent = priced ? "per repository" : "this program can't buy it";
  $("#ingot-svg").setAttribute("aria-label", priced ? `Indicative range $${r.low} to $${r.high} per repository` : "Not eligible for the current program");
  $("#result-text").textContent = priced
    ? "Based on what you told us. The final figure is confirmed after a quality review. We can't check these answers yet, so the range is deliberately low."
    : "From what you entered, our current buyer can't take this repository, so we won't show a price.";
  const checks = [
    ...r.eligibility.failed.map((x) => `<li><span class="vh">Not met: </span>${x.label}</li>`),
    ...r.eligibility.pending.map((x) => `<li class="pending">${x.label}: can't tell from a range yet, we'll confirm it with you</li>`),
  ];
  $("#checks").innerHTML = checks.length ? checks.join("") : `<li class="pending" style="list-style:none">Meets our buyer's requirements on everything you told us.</li>`;
  $("#factors").innerHTML = r.factors.map((f) => `<li><i class="${f.direction === "up" ? "up" : ""}" aria-hidden="true">${f.direction === "up" ? "▲" : f.direction === "down" ? "▼" : "·"}</i><span>${f.explanation}</span></li>`).join("");
  $("#interest").hidden = !priced || $("#interest-done").hidden === false;
  // Hidden fields so the enquiry email carries the answers and the range shown.
  const fill = (name, v) => ($(`#interest input[name="${name}"]`).value = v);
  fill("Language", state.language);
  fill("Merged pull requests", state.prMode === "exact" ? state.prCount : PR_BUCKETS.find((b) => b.value === state.prBucket).label + " (range)");
  fill("Repository age", AGE.find((x) => x.value === state.age).label);
  fill("Team size", CONTRIBUTORS.find((x) => x.value === state.contributors).label);
  fill("Size", sizeOptions.find((x) => x.value === state.size).label);
  fill("Estimate shown", priced ? `$${r.low}–$${r.high} (engine ${r.engineVersion})` : "Not eligible");
}

let timer = null;
function changed() {
  if (!shown) return;
  clearTimeout(timer);
  timer = setTimeout(render, 120);
}

$("#calc-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (needsPr()) { $("#calc-error").hidden = false; $("#pr").focus(); return; }
  $("#calc-error").hidden = true;
  shown = true;
  $("#weigh-block").hidden = true;
  $("#result").hidden = false;
  render();
  if (matchMedia("(max-width: 800px)").matches) $("#result").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
});

/* The ingot tilts with the pointer, like the homepage's "Give it a spin." object. */
const stage = $("#ingot-stage"), tiltEl = $("#ingot-tilt");
stage.addEventListener("pointermove", (e) => {
  if (reduceMotion) return;
  const b = stage.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
  tiltEl.style.transform = `rotateX(${(-y * 14).toFixed(1)}deg) rotateY(${(x * 18).toFixed(1)}deg)`;
});
stage.addEventListener("pointerleave", () => (tiltEl.style.transform = ""));

/* "Would you sell at this range?" — sent through the site's existing form provider. */
const interest = $("#interest");
interest.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("#interest-status"), submit = $("#interest-submit");
  submit.disabled = true;
  status.textContent = "Sending…";
  status.className = "form-status";
  try {
    const res = await fetch(interest.action, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(interest))) });
    if (!res.ok) throw new Error("Request failed");
    const out = await res.json();
    if (out.success !== true && out.success !== "true") throw new Error("Rejected");
    interest.hidden = true;
    const done = $("#interest-done");
    done.hidden = false;
    done.tabIndex = -1;
    done.focus();
  } catch {
    status.textContent = "We couldn't send that. Try again, or email harshchauhan@whynotforge.com.";
    status.className = "form-status form-status-err";
    submit.disabled = false;
  }
});
