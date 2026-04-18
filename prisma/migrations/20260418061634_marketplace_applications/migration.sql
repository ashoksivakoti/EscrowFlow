-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ProjectApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'OPEN';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "visibility" "ProjectVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "project_applications" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "freelancerUserId" TEXT NOT NULL,
    "coverLetter" TEXT NOT NULL,
    "portfolioLink" TEXT,
    "proposedTimeline" TEXT,
    "status" "ProjectApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_applications_projectId_status_idx" ON "project_applications"("projectId", "status");

-- CreateIndex
CREATE INDEX "project_applications_freelancerUserId_status_idx" ON "project_applications"("freelancerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_applications_projectId_freelancerUserId_key" ON "project_applications"("projectId", "freelancerUserId");

-- CreateIndex
CREATE INDEX "projects_status_visibility_updatedAt_idx" ON "projects"("status", "visibility", "updatedAt");

-- AddForeignKey
ALTER TABLE "project_applications" ADD CONSTRAINT "project_applications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_applications" ADD CONSTRAINT "project_applications_freelancerUserId_fkey" FOREIGN KEY ("freelancerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
