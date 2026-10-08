// Renders a line graph of daily contributions over the last DAYS days as an
// SVG, styled to match the "radical" theme used by the other profile cards.
//
// Usage: GITHUB_TOKEN=... node activity-graph.mjs <username> <output.svg>

import { writeFileSync } from "node:fs";

const DAYS = 31;
const WIDTH = 1000;
const HEIGHT = 320;
const PAD = { top: 85, right: 30, bottom: 45, left: 55 };

const colors = {
  background: "#141321",
  title: "#fe428e",
  line: "#fe428e",
  point: "#f8d847",
  text: "#a9fef7",
  grid: "#2c2a40",
};

const [username, output] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!username || !output || !token) {
  console.error("Usage: GITHUB_TOKEN=... node activity-graph.mjs <username> <output.svg>");
  process.exit(1);
}

const to = new Date();
const from = new Date(to.getTime() - (DAYS - 1) * 24 * 60 * 60 * 1000);

const query = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      name
      login
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query,
    variables: { login: username, from: from.toISOString(), to: to.toISOString() },
  }),
});
const json = await res.json();
if (!res.ok || json.errors || !json.data?.user) {
  console.error("GitHub API request failed:", JSON.stringify(json.errors ?? json));
  process.exit(1);
}

const { user } = json.data;
const days = user.contributionsCollection.contributionCalendar.weeks
  .flatMap((week) => week.contributionDays)
  .slice(-DAYS);
if (days.length === 0) {
  console.error("No contribution data returned");
  process.exit(1);
}

const counts = days.map((day) => day.contributionCount);
const total = counts.reduce((sum, count) => sum + count, 0);

// Pick a round gridline step so the y-axis reads 0, step, 2*step, ...
const max = Math.max(...counts, 1);
const raw = max / 4;
const magnitude = 10 ** Math.floor(Math.log10(raw));
const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw));
const top = Math.ceil(max / step) * step;

const plotWidth = WIDTH - PAD.left - PAD.right;
const plotHeight = HEIGHT - PAD.top - PAD.bottom;
const x = (i) => PAD.left + (days.length === 1 ? plotWidth / 2 : (i * plotWidth) / (days.length - 1));
const y = (count) => PAD.top + plotHeight - (count / top) * plotHeight;
const fmt = (n) => Number(n.toFixed(2));

const points = counts.map((count, i) => [fmt(x(i)), fmt(y(count))]);
const linePath = points.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ");
const baseline = fmt(y(0));
const areaPath = `${linePath} L${points.at(-1)[0]},${baseline} L${points[0][0]},${baseline} Z`;

const gridlines = [];
for (let value = 0; value <= top; value += step) {
  const gy = fmt(y(value));
  gridlines.push(
    `<line x1="${PAD.left}" y1="${gy}" x2="${WIDTH - PAD.right}" y2="${gy}" stroke="${colors.grid}" stroke-width="1"/>`,
    `<text x="${PAD.left - 12}" y="${gy + 4}" text-anchor="end" class="label">${value}</text>`,
  );
}

const xLabels = days.map(
  (day, i) => `<text x="${fmt(x(i))}" y="${HEIGHT - PAD.bottom + 22}" text-anchor="middle" class="label">${Number(day.date.slice(8))}</text>`,
);

const dots = days.map(
  (day, i) =>
    `<circle cx="${points[i][0]}" cy="${points[i][1]}" r="3.5" fill="${colors.point}" class="dot"><title>${day.date}: ${day.contributionCount} contributions</title></circle>`,
);

const escapeXml = (s) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const displayName = escapeXml(user.name || user.login);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">${displayName}'s Contribution Graph</title>
  <desc id="desc">${total} contributions in the last ${DAYS} days</desc>
  <style>
    .title { font: 600 20px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${colors.title}; }
    .subtitle { font: 400 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${colors.text}; opacity: 0.8; }
    .label { font: 400 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${colors.text}; opacity: 0.7; }
    .line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 2s ease-out forwards; }
    .area, .dot { opacity: 0; animation: fade 0.8s ease-in 1.2s forwards; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes fade { to { opacity: 1; } }
  </style>
  <defs>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${colors.line}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${colors.line}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" rx="4.5" fill="${colors.background}"/>
  <text x="${PAD.left - 30}" y="35" class="title">${displayName}'s Contribution Graph</text>
  <text x="${PAD.left - 30}" y="55" class="subtitle">${total} contributions in the last ${DAYS} days</text>
  ${gridlines.join("\n  ")}
  ${xLabels.join("\n  ")}
  <path d="${areaPath}" fill="url(#area)" class="area"/>
  <path d="${linePath}" fill="none" stroke="${colors.line}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" pathLength="1" class="line"/>
  ${dots.join("\n  ")}
</svg>
`;

writeFileSync(output, svg);
console.log(`Wrote ${output}: ${total} contributions over ${days.length} days`);
