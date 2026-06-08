import { GdeltClient } from "./gdelt-client";
import { GdeltProvider } from "./gdelt-provider";

export * from "./gdelt-client";
export * from "./gdelt-provider";
export * from "./gdelt.types";

export const gdeltClient = new GdeltClient();
export const gdeltProvider = new GdeltProvider(gdeltClient);
