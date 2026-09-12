import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: {
        code: "not_implemented",
        message: "Reading a research run is not implemented yet.",
      },
    },
    { status: 501 },
  );
}
