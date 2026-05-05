import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AttributionPoint, ForecastPoint, ScenarioType, WeatherPoint } from "@/lib/types";

// Optional natural-language narration overlay. Supports Azure OpenAI (preferred for
// enterprise demo) or standard OpenAI as fallback. Responses cached on disk by content
// hash — demo never depends on live network after first run.
//
// Azure OpenAI: set AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT in .env.local
// Standard OpenAI: set OPENAI_API_KEY (+ optional OPENAI_MODEL, default gpt-4o-mini)
//
// Production note: this layer narrates synthetic demo data only; production swaps
// for on-prem model or removes it entirely per KREDL data-residency requirements.

export interface NarrationInput {
  plantId: string;
  plantName: string;
  plantType: string;
  capacityMW: number;
  scenario: ScenarioType;
  points: ForecastPoint[];
  attribution: AttributionPoint[];
  weather: WeatherPoint[];
}

export interface NarrationResult {
  text: string;
  source: "AZURE_OPENAI" | "OPENAI" | "DETERMINISTIC_FALLBACK";
  cached: boolean;
}

function cacheDir(): string {
  return join(process.cwd(), "data", "llm-cache");
}

function hashOf(input: NarrationInput): string {
  const reduced = {
    plantId: input.plantId,
    scenario: input.scenario,
    points: input.points.map((p) => ({ t: p.timestamp, mw: p.forecastMW })),
    attribution: input.attribution.map((a) => ({
      t: a.timestamp,
      base: a.baselineMW,
      cloud: a.cloudPenaltyMW,
      temp: a.tempDeratingMW,
      wind: a.windFactorMW,
      scen: a.scenarioAdjustmentMW,
    })),
  };
  return createHash("sha256").update(JSON.stringify(reduced)).digest("hex").slice(0, 16);
}

function readCache(key: string): string | null {
  const path = join(cacheDir(), `${key}.txt`);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function writeCache(key: string, text: string): void {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(join(cacheDir(), `${key}.txt`), text);
}

function deterministicFallback(input: NarrationInput): string {
  const meanMW = input.points.length === 0 ? 0 : input.points.reduce((s, p) => s + p.forecastMW, 0) / input.points.length;
  const peakIdx = input.points.reduce((max, p, idx) => (p.forecastMW > input.points[max].forecastMW ? idx : max), 0);
  const peak = input.points[peakIdx];
  const peakAttr = peak ? input.attribution[peakIdx] : undefined;

  if (!peak || !peakAttr) {
    return `Mean projected output ${meanMW.toFixed(1)} MW under ${input.scenario.toLowerCase()} scenario.`;
  }

  const dropDrivers: string[] = [];
  if (peakAttr.cloudPenaltyMW > 0.5) dropDrivers.push(`cloud cover (${peakAttr.cloudPenaltyMW.toFixed(1)} MW penalty)`);
  if (peakAttr.tempDeratingMW > 0.5) dropDrivers.push(`heat (${peakAttr.tempDeratingMW.toFixed(1)} MW derate)`);
  if (peakAttr.windFactorMW < -0.5) dropDrivers.push(`wind shortfall (${(-peakAttr.windFactorMW).toFixed(1)} MW)`);
  const driverText = dropDrivers.length > 0 ? ` Top drivers: ${dropDrivers.join(", ")}.` : "";

  return (
    `Peak ${peak.forecastMW.toFixed(1)} MW at ` +
    `${new Date(peak.timestamp).toISOString().slice(11, 16)} (${input.scenario.toLowerCase()}). ` +
    `Mean ${meanMW.toFixed(1)} MW.` +
    driverText
  );
}

async function callLLM(input: NarrationInput): Promise<{ text: string; source: "AZURE_OPENAI" | "OPENAI" }> {
  const systemPrompt =
    "You are a grid-operations analyst at KSPDCL (Karnataka grid operator) advising the dispatch desk. " +
    "Write 3 short sentences in this exact structure:\n" +
    "1. PEAK: state peak MW and the hour it occurs.\n" +
    "2. RISK: identify the biggest ramp event (rapid MW change between consecutive hours) AND the dominant driver (cloud / heat / wind shortfall) in MW terms.\n" +
    "3. ACTION: a concrete dispatch recommendation (e.g. 'Pre-schedule X MW thermal backup by HH:MM' or 'Curtailment risk LOW; no action needed').\n\n" +
    "Rules: Use only the numbers given — do NOT invent values. Be specific about hours (24-hour format). " +
    "Use Indian power-sector terms: 'thermal backup', 'pre-schedule', 'ramp', 'curtailment'. " +
    "Keep total under 65 words.";

  // Pre-compute ramp events so the LLM doesn't have to reason over raw timeseries
  const ramps: Array<{ from: string; to: string; deltaMW: number }> = [];
  for (let i = 1; i < input.points.length; i++) {
    const delta = input.points[i].forecastMW - input.points[i - 1].forecastMW;
    if (Math.abs(delta) >= input.capacityMW * 0.1) {
      ramps.push({
        from: new Date(input.points[i - 1].timestamp).toISOString().slice(11, 16),
        to: new Date(input.points[i].timestamp).toISOString().slice(11, 16),
        deltaMW: Number(delta.toFixed(1)),
      });
    }
  }
  const biggestRamp = ramps.reduce<typeof ramps[number] | null>(
    (max, r) => (max === null || Math.abs(r.deltaMW) > Math.abs(max.deltaMW) ? r : max),
    null,
  );

  const peakIdx = input.points.reduce((mi, p, i) => (p.forecastMW > input.points[mi].forecastMW ? i : mi), 0);
  const peak = input.points[peakIdx];

  const totalCloudPenalty = input.attribution.reduce((s, a) => s + a.cloudPenaltyMW, 0);
  const totalTempDerate = input.attribution.reduce((s, a) => s + a.tempDeratingMW, 0);
  const totalWindShortfall = input.attribution.reduce((s, a) => s + Math.max(0, -a.windFactorMW), 0);

  const userPayload = {
    plant: { name: input.plantName, type: input.plantType, capacityMW: input.capacityMW },
    scenario: input.scenario,
    peak: peak ? { timeUTC: new Date(peak.timestamp).toISOString().slice(11, 16), mw: Number(peak.forecastMW.toFixed(1)) } : null,
    biggestRamp,
    driverTotalsMW: {
      cloudPenalty: Number(totalCloudPenalty.toFixed(1)),
      tempDerate: Number(totalTempDerate.toFixed(1)),
      windShortfall: Number(totalWindShortfall.toFixed(1)),
    },
    forecast: input.points.slice(0, 24).map((p) => ({
      time: new Date(p.timestamp).toISOString().slice(11, 16),
      mw: Number(p.forecastMW.toFixed(1)),
    })),
  };

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(userPayload) },
  ];

  // Azure OpenAI takes priority (enterprise AI tool for hackathon)
  const azureKey = process.env.AZURE_OPENAI_API_KEY;
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (azureKey && azureEndpoint) {
    const res = await fetch(azureEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": azureKey },
      body: JSON.stringify({ messages, max_tokens: 220, temperature: 0.2 }),
    });
    if (!res.ok) throw new Error(`Azure OpenAI HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Azure OpenAI returned empty content");
    return { text, source: "AZURE_OPENAI" };
  }

  // Standard OpenAI fallback
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No LLM API key configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-4o-mini", messages, max_tokens: 220, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned empty content");
  return { text, source: "OPENAI" };
}

// ─── shared raw LLM caller (no cache) ──────────────────────────────────────
async function rawLLM(systemPrompt: string, userContent: string, maxTokens = 180): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
  const azureKey = process.env.AZURE_OPENAI_API_KEY;
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (azureKey && azureEndpoint) {
    const res = await fetch(azureEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": azureKey },
      body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: 0.2 }),
    });
    if (!res.ok) throw new Error(`Azure OpenAI HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No LLM API key configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: maxTokens, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

// ─── 1. Dashboard Daily Briefing ────────────────────────────────────────────
export interface DailyBriefingInput {
  totalCapacityMW: number;
  currentOutputMW: number;
  tomorrowForecastMW: number;
  openAlerts: number;
  topClusters: Array<{ id: string; totalCapacityMW: number; weightedMape?: number }>;
  meanImprovementVsPersistence: number;
}

export async function generateDailyBriefing(input: DailyBriefingInput): Promise<string> {
  const cacheKey = createHash("sha256")
    .update(JSON.stringify({ ...input, day: new Date().toISOString().slice(0, 10) }))
    .digest("hex")
    .slice(0, 16);
  const cached = readCache(`briefing_${cacheKey}`);
  if (cached) return cached;

  const hasLLM = !!(process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
  if (!hasLLM) {
    return `Karnataka grid: ${input.tomorrowForecastMW.toFixed(0)} MW forecast tomorrow across ${input.topClusters.length} clusters. ${input.openAlerts} open alerts.`;
  }

  const system =
    "You are the AI grid-operations assistant for KSPDCL (Karnataka State Power Distribution Corporation). " +
    "Write a 3-sentence morning briefing for the dispatch desk. Structure:\n" +
    "1. Fleet outlook: total tomorrow forecast MW and % utilisation of capacity.\n" +
    "2. Cluster highlight: name the top cluster and flag any concern (high MAPE = uncertainty).\n" +
    "3. Recommendation: thermal standby MW and alert action needed.\n" +
    "Use Indian power-sector language. Be specific with numbers. Under 70 words total.";

  const utilizationPct = ((input.tomorrowForecastMW / input.totalCapacityMW) * 100).toFixed(0);
  const topCluster = input.topClusters[0];
  const user = JSON.stringify({
    totalCapacityMW: input.totalCapacityMW,
    tomorrowForecastMW: input.tomorrowForecastMW,
    utilizationPct,
    currentOutputMW: input.currentOutputMW,
    openAlerts: input.openAlerts,
    topCluster: topCluster ?? null,
    avgImprovementVsPersistencePct: input.meanImprovementVsPersistence.toFixed(1),
  });

  try {
    const text = await rawLLM(system, user, 200);
    writeCache(`briefing_${cacheKey}`, text);
    return text;
  } catch {
    return `Karnataka grid: ${input.tomorrowForecastMW.toFixed(0)} MW forecast tomorrow (${utilizationPct}% utilisation). ${input.openAlerts} alert${input.openAlerts !== 1 ? "s" : ""} open. Review clusters before dispatch scheduling.`;
  }
}

// ─── 2. Alert AI Explanation ─────────────────────────────────────────────────
export interface AlertExplainInput {
  alertId: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  plantName: string | null;
  plantType: string | null;
}

export async function explainAlert(input: AlertExplainInput): Promise<string> {
  const cacheKey = createHash("sha256").update(input.alertId).digest("hex").slice(0, 16);
  const cached = readCache(`alert_${cacheKey}`);
  if (cached) return cached;

  const hasLLM = !!(process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
  if (!hasLLM) return input.description;

  const system =
    "You are a KSPDCL grid-operations analyst. Given an alert, write 2 sentences:\n" +
    "1. What is happening in plain language (translate the alert type into operational meaning).\n" +
    "2. What the dispatch desk should do RIGHT NOW (specific action with a time window if possible).\n" +
    "No jargon. Be direct. Under 45 words total.";

  const user = JSON.stringify({
    type: input.type,
    severity: input.severity,
    title: input.title,
    description: input.description,
    plant: input.plantName,
    plantType: input.plantType,
  });

  try {
    const text = await rawLLM(system, user, 120);
    writeCache(`alert_${cacheKey}`, text);
    return text;
  } catch {
    return input.description;
  }
}

// ─── 3. Retrain AI Report ────────────────────────────────────────────────────
export interface RetrainReportInput {
  newVersion: string;
  newMape: number;
  previousVersion: string | null;
  previousMape: number | null;
  trainedOnDays: number;
}

export async function generateRetrainReport(input: RetrainReportInput): Promise<string> {
  const cacheKey = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);
  const cached = readCache(`retrain_${cacheKey}`);
  if (cached) return cached;

  const hasLLM = !!(process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
  const improvement = input.previousMape ? input.previousMape - input.newMape : null;
  if (!hasLLM) {
    return improvement !== null && improvement > 0
      ? `${input.newVersion} trained. MAPE improved by ${improvement.toFixed(2)}% vs ${input.previousVersion}.`
      : `${input.newVersion} trained on ${input.trainedOnDays}-day rolling window. MAPE: ${input.newMape.toFixed(2)}%.`;
  }

  const system =
    "You are an MLOps engineer at KSPDCL. Write a 3-sentence retrain report:\n" +
    "1. What version was trained and on how much data.\n" +
    "2. MAPE improvement vs previous version (positive = better, calculate % change).\n" +
    "3. Deployment recommendation: safe to deploy fleet-wide, or validate on specific cluster first.\n" +
    "Use ML + power-sector language. Under 60 words.";

  const user = JSON.stringify(input);

  try {
    const text = await rawLLM(system, user, 160);
    writeCache(`retrain_${cacheKey}`, text);
    return text;
  } catch {
    return `${input.newVersion} retrained on ${input.trainedOnDays}-day window. MAPE: ${input.newMape.toFixed(2)}%.`;
  }
}

export async function narrateForecast(input: NarrationInput): Promise<NarrationResult> {
  const key = hashOf(input);
  const cached = readCache(key);
  if (cached) {
    const source = process.env.AZURE_OPENAI_API_KEY ? "AZURE_OPENAI" : "OPENAI";
    return { text: cached, source, cached: true };
  }

  const hasLLM = !!(process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
  if (!hasLLM) {
    return { text: deterministicFallback(input), source: "DETERMINISTIC_FALLBACK", cached: false };
  }

  try {
    const { text, source } = await callLLM(input);
    writeCache(key, text);
    return { text, source, cached: false };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[llm-narration] LLM call failed (${(err as Error).message}); falling back to deterministic.`);
    return { text: deterministicFallback(input), source: "DETERMINISTIC_FALLBACK", cached: false };
  }
}
