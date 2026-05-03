import { NextResponse } from "next/server";

export function success<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function failure(
  status: number,
  code: string,
  message: string,
  provider?: string
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(provider ? { provider } : {}),
      },
    },
    { status }
  );
}
