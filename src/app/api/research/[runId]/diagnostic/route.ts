import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: "not_implemented",
        message: "Generating a diagnostic is not implemented yet.",
      },
    },
    { status: 501 },
  );
}
