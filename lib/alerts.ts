import type { AlertCandidate, AlertSeverity, AlertType, ForecastPoint, GenerationPoint, PlantStatus } from "@/lib/types";

function severityForRamp(deltaPct: number): AlertSeverity {
  if (deltaPct > 0.65) return "CRITICAL";
  if (deltaPct > 0.5) return "HIGH";
  return "MEDIUM";
}

export function detectForecastAlerts(input: {
  plantId: string;
  plantName: string;
  capacityMW: number;
  forecast: ForecastPoint[];
  status: PlantStatus;
}): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];

  if (input.status === "OFFLINE") {
    alerts.push({
      plantId: input.plantId,
      type: "PLANT_OFFLINE",
      severity: "CRITICAL",
      title: `${input.plantName} offline`,
      description: "Plant status is OFFLINE and requires operator intervention.",
      evidence: { status: input.status },
    });
  }

  for (let i = 1; i < input.forecast.length; i += 1) {
    const prev = input.forecast[i - 1];
    const curr = input.forecast[i];
    const delta = curr.forecastMW - prev.forecastMW;
    const deltaPct = Math.abs(delta) / Math.max(input.capacityMW, 0.1);

    if (deltaPct > 0.4) {
      const type: AlertType = delta > 0 ? "RAMP_UP_STEEP" : "RAMP_DOWN_STEEP";
      alerts.push({
        plantId: input.plantId,
        type,
        severity: severityForRamp(deltaPct),
        title: `${input.plantName} ${type === "RAMP_UP_STEEP" ? "ramp-up" : "ramp-down"} risk`,
        description: `Forecast shifts by ${(deltaPct * 100).toFixed(1)}% of capacity in one hour.`,
        evidence: {
          fromTimestamp: prev.timestamp,
          toTimestamp: curr.timestamp,
          previousMW: prev.forecastMW,
          currentMW: curr.forecastMW,
        },
      });
    }

    if (curr.forecastMW > input.capacityMW * 0.95) {
      alerts.push({
        plantId: input.plantId,
        type: "CURTAILMENT_RISK",
        severity: "HIGH",
        title: `${input.plantName} curtailment risk`,
        description: "Forecast approaches rated capacity; likely dispatch limitation window.",
        evidence: { timestamp: curr.timestamp, forecastMW: curr.forecastMW, capacityMW: input.capacityMW },
      });
    }
  }

  return alerts;
}

export function detectAccuracyAlerts(input: {
  plantId: string;
  plantName: string;
  actual: GenerationPoint[];
  baselineForecast: ForecastPoint[];
}): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const length = Math.min(input.actual.length, input.baselineForecast.length);
  let underCount = 0;
  let overCount = 0;

  for (let i = 0; i < length; i += 1) {
    const a = input.actual[i].actualMW;
    const f = input.baselineForecast[i];
    if (a < f.lowerBoundMW) {
      underCount += 1;
      overCount = 0;
    } else if (a > f.upperBoundMW) {
      overCount += 1;
      underCount = 0;
    } else {
      underCount = 0;
      overCount = 0;
    }

    if (underCount >= 3) {
      alerts.push({
        plantId: input.plantId,
        type: "UNDER_FORECAST",
        severity: "MEDIUM",
        title: `${input.plantName} persistent under-forecast`,
        description: "Actual output stayed below lower confidence bound for 3+ hours.",
        evidence: { timestamp: input.actual[i].timestamp, streak: underCount },
      });
      underCount = 0;
    }

    if (overCount >= 3) {
      alerts.push({
        plantId: input.plantId,
        type: "OVER_FORECAST",
        severity: "MEDIUM",
        title: `${input.plantName} persistent over-forecast`,
        description: "Actual output stayed above upper confidence bound for 3+ hours.",
        evidence: { timestamp: input.actual[i].timestamp, streak: overCount },
      });
      overCount = 0;
    }
  }

  return alerts;
}

export interface DriftInput {
  plantId: string;
  plantName: string;
  mape7d: number;
  mape30d: number;
  threshold?: number; // default 1.5
}

export function detectModelDrift(input: DriftInput): AlertCandidate | null {
  const threshold = input.threshold ?? 1.5;
  if (input.mape30d <= 0) return null;
  if (input.mape7d <= input.mape30d * threshold) return null;

  const ratio = input.mape7d / input.mape30d;
  const severity: AlertSeverity = ratio > 2 ? "HIGH" : "MEDIUM";
  return {
    plantId: input.plantId,
    type: "MODEL_DRIFT",
    severity,
    title: `${input.plantName} model drift detected`,
    description:
      `Rolling 7-day MAPE (${input.mape7d.toFixed(2)}%) is ${ratio.toFixed(2)}× the 30-day average (${input.mape30d.toFixed(2)}%). Retrain recommended.`,
    evidence: {
      mape7d: input.mape7d,
      mape30d: input.mape30d,
      ratio: Number(ratio.toFixed(2)),
      threshold,
    },
  };
}
