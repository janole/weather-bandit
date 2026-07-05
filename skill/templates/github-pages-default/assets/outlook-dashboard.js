/* global document, window, IntersectionObserver */

const WMO = new Map([
  [0, "Clear sky"],
  [1, "Mainly clear"],
  [2, "Partly cloudy"],
  [3, "Overcast"],
  [45, "Fog"],
  [48, "Rime fog"],
  [51, "Light drizzle"],
  [53, "Moderate drizzle"],
  [55, "Dense drizzle"],
  [56, "Freezing drizzle"],
  [57, "Dense freezing drizzle"],
  [61, "Slight rain"],
  [63, "Moderate rain"],
  [65, "Heavy rain"],
  [66, "Freezing rain"],
  [67, "Heavy freezing rain"],
  [71, "Slight snow"],
  [73, "Moderate snow"],
  [75, "Heavy snow"],
  [77, "Snow grains"],
  [80, "Rain showers"],
  [81, "Moderate showers"],
  [82, "Violent showers"],
  [85, "Snow showers"],
  [86, "Heavy snow showers"],
  [95, "Thunderstorm"],
  [96, "Thunderstorm, hail"],
  [99, "Thunderstorm, heavy hail"],
]);

function html(strings, ...values)
{
  return strings.reduce((out, chunk, i) => out + chunk + escapeHtml(values[i] ?? ""), "");
}

function escapeHtml(value)
{
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function fmt(value, unit = "", digits = 0)
{
  if (value === null || value === undefined || Number.isNaN(Number(value)))
  {
    return "—";
  }
  const n = Number(value);
  const rounded = digits > 0 ? Math.round(n * 10 ** digits) / 10 ** digits : Math.round(n);
  return `${rounded}${unit}`;
}

function percent(value)
{
  return fmt((value ?? 0) * 100, "%");
}

function model(outlook, id)
{
  return outlook.models.find((m) => m.model === id) ?? outlook.models[0];
}

function today(outlook)
{
  return model(outlook, "best-match")?.daily?.[0];
}

function max(values)
{
  const nums = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(Number(v)));
  return nums.length > 0 ? Math.max(...nums) : null;
}

function condition(code)
{
  return WMO.get(code) ?? `Weather code ${code ?? "—"}`;
}

function conditionTone(code)
{
  if ([61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([0, 1].includes(code)) return "clear";
  if ([2, 3].includes(code)) return "cloud";
  return "neutral";
}

function dailyRows(outlook)
{
  const best = model(outlook, "best-match");
  const probs = new Map(outlook.probabilities.map((p) => [p.date, p]));
  return (best?.daily ?? []).map((day) => ({ ...day, probability: probs.get(day.date) }));
}

function renderKpis(outlook)
{
  const day = today(outlook);
  const best = model(outlook, "best-match");
  const hours = best?.hourly?.filter((h) => h.time.startsWith(day?.date ?? "")) ?? [];
  const gust = max(hours.map((h) => h.windgusts));
  const hot = [...outlook.probabilities].sort((a, b) => b.pMax30 - a.pMax30)[0];
  const tone = conditionTone(day?.weatherCode);

  return html`
    <section class="dashboard-hero dashboard-reveal" data-tone="${tone}">
      <div class="dashboard-hero-main">
        <p class="dashboard-label">Today in ${outlook.location.name}</p>
        <h2>${condition(day?.weatherCode)}</h2>
        <p>${outlook.summary}</p>
      </div>
      <div class="dashboard-now" aria-label="Today summary">
        <div><span>${fmt(day?.tempMax, "°C")}</span><small>High</small></div>
        <div><span>${fmt(day?.tempMin, "°C")}</span><small>Low</small></div>
        <div><span>${fmt(day?.precipSum, "mm", 1)}</span><small>Rain</small></div>
        <div><span>${fmt(gust, "km/h")}</span><small>Gusts</small></div>
      </div>
    </section>

    <section class="dashboard-strip dashboard-reveal" aria-label="Forecast signals">
      <div class="signal-card">
        <span>Warmest day</span>
        <strong>${hot?.date ?? "—"}</strong>
        <small>${percent(hot?.pMax30)} chance ≥30°C</small>
      </div>
      <div class="signal-card">
        <span>Model runs</span>
        <strong>${outlook.models.length}</strong>
        <small>Best-match / GFS / ECMWF</small>
      </div>
      <div class="signal-card">
        <span>Generated</span>
        <strong>${new Date(outlook.generatedAt).toISOString().slice(0, 10)}</strong>
        <small>${outlook.forecastDays} day horizon</small>
      </div>
    </section>
  `;
}

function renderProbabilityArc(outlook)
{
  const rows = dailyRows(outlook);
  const maxTemp = max(rows.map((d) => d.tempMax)) ?? 1;
  const minTemp = Math.min(...rows.map((d) => d.tempMin ?? maxTemp));
  const span = Math.max(1, maxTemp - minTemp);
  const cards = rows.map((day, i) =>
  {
    const p = day.probability;
    const height = 26 + (((day.tempMax ?? minTemp) - minTemp) / span) * 62;
    const delay = `${i * 70}ms`;
    return html`
      <article class="day-column dashboard-reveal" style="--bar-height: ${height}%; --delay: ${delay}">
        <div class="day-bar" aria-hidden="true"></div>
        <div class="day-card">
          <span>${day.date.slice(5)}</span>
          <strong>${fmt(day.tempMax, "°")}</strong>
          <small>${condition(day.weatherCode)}</small>
          <em>${percent(p?.pMax30)} ≥30°C</em>
        </div>
      </article>
    `;
  }).join("");

  return `
    <section class="dashboard-panel dashboard-reveal">
      <div class="panel-heading">
        <p class="dashboard-label">Seven-day temperature arc</p>
        <h2>Probability, trend, and condition in one scan</h2>
      </div>
      <div class="temperature-arc">${cards}</div>
    </section>
  `;
}

function renderModelComparison(outlook)
{
  const labels = new Map([
    ["best-match", "Best"],
    ["gfs", "GFS"],
    ["ecmwf", "ECMWF"],
  ]);
  const rows = outlook.models.map((run) =>
  {
    const day = run.daily?.[0];
    return html`
      <li>
        <span>${labels.get(run.model) ?? run.model}</span>
        <strong>${fmt(day?.tempMax, "°C", 1)}</strong>
        <small>${fmt(day?.precipSum, "mm", 1)} rain / ${fmt(day?.windMax, "km/h", 1)} wind</small>
      </li>
    `;
  }).join("");

  const disagreements = countDisagreements(outlook.summary);
  return `
    <section class="dashboard-grid">
      <article class="dashboard-panel dashboard-reveal">
        <div class="panel-heading">
          <p class="dashboard-label">Model spread</p>
          <h2>Today, side by side</h2>
        </div>
        <ol class="model-list">${rows}</ol>
      </article>
      <article class="dashboard-panel dashboard-reveal">
        <div class="panel-heading">
          <p class="dashboard-label">Cross-validation</p>
          <h2>What deserves attention</h2>
        </div>
        <div class="disagreement-note" data-count="${escapeHtml(disagreements)}">
          <strong>${escapeHtml(disagreements)}</strong>
          <span>flagged disagreement points in the generated summary.</span>
        </div>
        <p>${escapeHtml(outlook.summary)}</p>
      </article>
    </section>
  `;
}

function countDisagreements(summary)
{
  const match = summary.match(/Models disagree on (\d+) point/);
  return match ? Number(match[1]) : 0;
}

function renderDashboard(outlook)
{
  return [
    renderKpis(outlook),
    renderProbabilityArc(outlook),
    renderModelComparison(outlook),
  ].join("");
}

function observeReveals(root)
{
  if (!("IntersectionObserver" in window))
  {
    root.querySelectorAll(".dashboard-reveal").forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) =>
  {
    entries.forEach((entry) =>
    {
      if (entry.isIntersecting)
      {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.18 });
  root.querySelectorAll(".dashboard-reveal").forEach((el) => observer.observe(el));
}

async function initDashboard(root)
{
  const src = root.dataset.outlookSrc;
  if (!src)
  {
    return;
  }
  try
  {
    const response = await fetch(src);
    if (!response.ok)
    {
      throw new Error(`HTTP ${response.status}`);
    }
    const outlook = await response.json();
    root.innerHTML = renderDashboard(outlook);
    root.classList.add("is-ready");
    observeReveals(root);
  }
  catch (err)
  {
    root.innerHTML = html`<p class="dashboard-error">Could not load dashboard data from ${src}. The canonical outlook remains below.</p>`;
    console.warn("Weather Bandit dashboard failed", err);
  }
}

document.querySelectorAll("[data-outlook-dashboard]").forEach((root) =>
{
  void initDashboard(root);
});
