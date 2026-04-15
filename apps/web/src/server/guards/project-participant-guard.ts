import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors/app-error";

export type ProjectParticipantContext = {
  project: {
    id: string;
    clientUserId: string;
    freelancerUserId: string | null;
  };
  as: "CLIENT" | "FREELANCER";
};

/**
 * Resource-level authorization helper. Use in project/milestone/dispute services.
 */
export async function requireProjectParticipant(
  projectId: string,
  userId: string,
): Promise<ProjectParticipantContext> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      clientUserId: true,
      freelancerUserId: true,
    },
  });
  if (!project) {
    throw AppError.notFound("PROJECT_NOT_FOUND", "Project not found");
  }
  if (project.clientUserId === userId) {
    return { project, as: "CLIENT" };
  }
  if (project.freelancerUserId === userId) {
    return { project, as: "FREELANCER" };
  }
  throw AppError.forbidden("You are not a participant in this project");
}
