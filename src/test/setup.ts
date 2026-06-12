import { afterAll, beforeAll, beforeEach } from "vitest";

import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { resetTestData, testPrisma, verifyDatabaseConnection } from "./test-db";

beforeAll(async () => {
  await verifyDatabaseConnection();
  await resetTestData();
});

beforeEach(async () => {
  env.NODE_ENV = "test";
  env.AUTH_ENABLED = false;
  await resetTestData();
});

afterAll(async () => {
  await resetTestData();
  await Promise.all([testPrisma.$disconnect(), prisma.$disconnect()]);
});
