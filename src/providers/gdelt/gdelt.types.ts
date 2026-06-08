export interface GdeltDocArticle {
  title?: string;
  url?: string;
  domain?: string;
  seendate?: string;
  socialimage?: string;
  sourcecountry?: string;
  language?: string;
  tone?: number | string;
}

export interface GdeltDocResponse {
  articles?: GdeltDocArticle[];
}
