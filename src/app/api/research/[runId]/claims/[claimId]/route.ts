import { NextResponse } from "next/server";

export async function PATCH() {
  return NextResponse.json(
    {
      error: {
        code: "not_implemented",
        message: "Updating a claim review is not implemented yet.",
      },
    },
    { status: 501 },
  );
}
