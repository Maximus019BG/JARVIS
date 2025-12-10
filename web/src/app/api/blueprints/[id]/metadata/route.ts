import { type NextRequest, NextResponse } from "next/server";

// Sample metadata for testing - replace with actual DB query
const sampleMetadata = {
  created_timestamp: 1764370427780,
  grid: {
    grid_spacing_percent: 5,
    real_world_spacing_cm: 5,
    show_measurements: true,
    snap_to_grid: true,
  },
  height: 768,
  lines: [
    {
      x0: 45,
      x1: 40,
      y0: 5,
      y1: 95,
    },
    {
      x0: 85,
      x1: 80,
      y0: 65,
      y1: 90,
    },
    {
      x0: 95,
      x1: 65,
      y0: 15,
      y1: 0,
    },
    {
      x0: 90,
      x1: 60,
      y0: 10,
      y1: 0,
    },
    {
      x0: 95,
      x1: 75,
      y0: 30,
      y1: 0,
    },
  ],
  name: "test",
  signature: "5243dba111a830f215fda6a37d45a21e21d0dc2fbfb7547d8be6a7c02d9d1807",
  width: 1366,
};

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    // TODO: Replace with actual database query
    // Example:
    // const blueprint = await db.query.blueprints.findFirst({
    //   where: eq(blueprints.id, id),
    //   columns: { metadata: true }
    // });
    //
    // if (!blueprint) {
    //   return NextResponse.json(
    //     { error: "Blueprint not found" },
    //     { status: 404 }
    //   );
    // }
    //
    // return NextResponse.json(blueprint.metadata);

    // For now, return sample metadata for any ID
    return NextResponse.json({
      ...sampleMetadata,
      name: `Blueprint ${id}`,
    });
  } catch (error) {
    console.error("Error fetching blueprint metadata:", error);
    return NextResponse.json(
      { error: "Failed to fetch blueprint metadata" },
      { status: 500 },
    );
  }
}
