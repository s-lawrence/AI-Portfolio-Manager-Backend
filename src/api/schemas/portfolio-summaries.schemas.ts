import { z } from "zod";

import { cuidSchema, optionalLimitSchema } from "./common.schemas";

export const portfolioSummaryParamsSchema = z.object({
  portfolioId: cuidSchema,
});

export const listPortfolioSummaryQuerySchema = z.object({
  limit: optionalLimitSchema,
});
