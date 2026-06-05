export interface FredSeriesObservationItem {
  date?: string;
  value?: string;
  realtime_start?: string;
  realtime_end?: string;
}

export interface FredSeriesObservationsResponse {
  realtime_start?: string;
  realtime_end?: string;
  observation_start?: string;
  observation_end?: string;
  units?: string;
  output_type?: number;
  file_type?: string;
  order_by?: string;
  sort_order?: string;
  count?: number;
  offset?: number;
  limit?: number;
  observations?: FredSeriesObservationItem[];
}
