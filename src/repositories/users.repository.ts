import { Prisma, User } from "@prisma/client";

import { prisma } from "../db/prisma";

export async function getUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export async function createUser(input: Prisma.UserCreateInput): Promise<User> {
  return prisma.user.create({ data: input });
}

export async function updateUser(
  id: string,
  input: Prisma.UserUpdateInput,
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: input,
  });
}

export async function deleteUser(id: string): Promise<User> {
  return prisma.user.delete({ where: { id } });
}

export async function listUsers(): Promise<User[]> {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });
}
