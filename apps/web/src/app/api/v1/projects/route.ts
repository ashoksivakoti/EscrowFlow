import type { NextResponse } from "next/server";

import { handleCreateProject } from "@/server/route-handlers/v1/projects/create";
import { handleListProjects } from "@/server/route-handlers/v1/projects/list";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleListProjects(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleCreateProject(request);
}
