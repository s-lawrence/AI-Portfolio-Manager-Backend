export interface GdeltDocArticle {
  title?: string;
  url?: string;
  domain?: string;
  sourcecommonname?: string;
  seendate?: string;
  socialimage?: string;
  sourcecountry?: string;
  language?: string;
  tone?: number | string;
  themes?: unknown;
  locations?: unknown;
  persons?: unknown;
  organizations?: unknown;
  v2themes?: unknown;
  v2locations?: unknown;
  v2persons?: unknown;
  v2organizations?: unknown;
}

export interface GdeltDocResponse {
  articles?: GdeltDocArticle[];
}
