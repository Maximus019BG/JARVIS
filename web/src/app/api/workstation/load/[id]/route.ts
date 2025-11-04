import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params: _params }: { params: { id: string } },
) {
  // Example response data with lines
  const data = {
    clear: true,
    lines: [
      { x0: 100, y0: 100, x1: 600, y1: 120, thickness: 6, color: "#FF0000" },
      { x0: 200, y0: 300, x1: 800, y1: 700, thickness: 3, color: "#00FF88" },
      { x0: 50, y0: 900, x1: 1200, y1: 200, thickness: 10, color: "#3366FF" },
    ],
  };

  return NextResponse.json(data);
}
