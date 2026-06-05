export interface BocSeriesValue {
  v?: string | number | null;
}

export interface BocObservationItem {
  d?: string;
  [seriesId: string]: unknown;
}

export interface BocObservationsResponse {
  observations?: BocObservationItem[];
}
