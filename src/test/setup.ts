import { afterAll, beforeAll, beforeEach } from "vitest";

import { prisma } from "../db/prisma";
import { resetTestData, testPrisma, verifyDatabaseConnection } from "./test-db";

beforeAll(async () => {
  await verifyDatabaseConnection();
  await resetTestData();
});

beforeEach(async () => {
  await resetTestData();
});

afterAll(async () => {
  await resetTestData();
  await Promise.all([testPrisma.$disconnect(), prisma.$disconnect()]);
});
