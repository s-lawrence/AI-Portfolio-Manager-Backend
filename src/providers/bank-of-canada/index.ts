import { BankOfCanadaProvider } from "./boc-provider";
import { BocClient } from "./boc-client";

export * from "./boc-client";
export * from "./boc-provider";
export * from "./boc.types";

export const bankOfCanadaClient = new BocClient();
export const bankOfCanadaProvider = new BankOfCanadaProvider(bankOfCanadaClient);
