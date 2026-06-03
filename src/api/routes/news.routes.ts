import type { FastifyInstance } from "fastify";

import { created, ok, paginated } from "../response";
import { runService } from "../errors";
import {
  bulkNewsBodySchema,
  newsArticleBodySchema,
  newsListQuerySchema,
  newsTickerParamsSchema,
} from "../schemas/news.schemas";
import {
  getNewsSentimentSummary,
  getRecentNewsForTicker,
  recordNewsArticle,
  recordNewsArticles,
} from "../../services";

export async function newsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/:ticker", async (request, reply) => {
    const params = newsTickerParamsSchema.parse(request.params);
    const body = newsArticleBodySchema.parse(request.body);

    const article = await runService(() => recordNewsArticle(params.ticker, body));
    reply.status(201).send(created(article));
  });

  app.post("/:ticker/bulk", async (request, reply) => {
    const params = newsTickerParamsSchema.parse(request.params);
    const body = bulkNewsBodySchema.parse(request.body);

    const articles = await runService(() =>
      recordNewsArticles(params.ticker, body.articles),
    );

    reply.status(201).send(created(articles));
  });

  app.get("/:ticker", async (request, reply) => {
    const params = newsTickerParamsSchema.parse(request.params);
    const query = newsListQuerySchema.parse(request.query);

    const articles = await runService(() =>
      getRecentNewsForTicker(params.ticker, query.limit),
    );

    reply.send(
      paginated(articles, {
        total: articles.length,
        limit: query.limit,
      }),
    );
  });

  app.get("/:ticker/sentiment-summary", async (request, reply) => {
    const params = newsTickerParamsSchema.parse(request.params);
    const query = newsListQuerySchema.parse(request.query);

    const summary = await runService(() =>
      getNewsSentimentSummary(params.ticker, query.limit),
    );

    reply.send(ok(summary));
  });
}
