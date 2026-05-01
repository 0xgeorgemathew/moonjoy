import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, _context: RouteContext) {
  return NextResponse.json(
    { error: "Challenge acceptance is retired. Use invite links instead." },
    { status: 410 },
  );
}
