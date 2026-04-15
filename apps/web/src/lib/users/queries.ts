import { prisma } from "@/lib/prisma";

import { userSessionInclude } from "@/lib/auth/user-mapper";

export async function getUserWithRolesById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: userSessionInclude,
  });
}
