import { FredClient } from "./fred-client";
import { FredProvider } from "./fred-provider";

export * from "./fred-client";
export * from "./fred-provider";
export * from "./fred.types";

export const fredClient = new FredClient();
export const fredProvider = new FredProvider(fredClient);
