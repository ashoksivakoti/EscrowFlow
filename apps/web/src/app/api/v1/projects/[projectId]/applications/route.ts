import type { NextResponse } from "next/server";

import {
  handleCreateProjectApplication,
  handleListProjectApplications,
} from "@/server/route-handlers/v1/projects/project-applications";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  const { projectId } = await params;
  return handleListProjectApplications(request, projectId);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  const { projectId } = await params;
  return handleCreateProjectApplication(request, projectId);
}
