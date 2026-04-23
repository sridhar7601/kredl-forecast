export type ForecastHorizon = "DAY_AHEAD" | "INTRADAY_6H" | "WEEK";
export type PlantType = "SOLAR_PV" | "WIND";
export type PlantStatus = "ACTIVE" | "MAINTENANCE" | "CURTAILED" | "OFFLINE";
export type ScenarioType = "BASE" | "OPTIMISTIC" | "PESSIMISTIC";
export type AlertType =
  | "RAMP_UP_STEEP"
  | "RAMP_DOWN_STEEP"
  | "CURTAILMENT_RISK"
  | "UNDER_FORECAST"
  | "OVER_FORECAST"
  | "PLANT_OFFLINE";
export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface GenerationPoint {
  timestamp: Date;
  actualMW: number;
  availableMW: number;
  curtailedMW: number;
}

export interface WeatherPoint {
  timestamp: Date;
  ghi?: number | null;
  cloudCover?: number | null;
  temperature?: number | null;
  windSpeed?: number | null;
  windDirection?: number | null;
  humidity?: number | null;
}

export interface ForecastPoint {
  timestamp: Date;
  forecastMW: number;
  lowerBoundMW: number;
  upperBoundMW: number;
}

export interface ForecastInput {
  plantId: string;
  plantType: PlantType;
  capacityMW: number;
  history: GenerationPoint[];
  weatherHistory: WeatherPoint[];
  weatherForecast: WeatherPoint[];
  horizon: ForecastHorizon;
  scenario: ScenarioType;
}

export interface AlertCandidate {
  plantId?: string | null;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
}

export interface PlantSummary {
  id: string;
  code: string;
  name: string;
  type: PlantType;
  capacityMW: number;
  district: string;
  status: PlantStatus;
}
