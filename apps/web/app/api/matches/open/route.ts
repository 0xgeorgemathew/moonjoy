import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Open challenges listing is retired. Use invite links instead." },
    { status: 410 },
  );
}
