import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint"
import { eq, and } from "drizzle-orm";

export async function GET(_request: Request, context: { params: { workstationId: string; blueprintId: string } }) {
  const { workstationId, blueprintId } = context.params; 

  if (!workstationId) {
    return NextResponse.json({ error: "Workstation not found" }, { status: 404 });
  }
  else if(!blueprintId){
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  //TODO:decode workstationId and blueprintId

  const data = await db
  .select()
  .from(blueprint)
  .where(and(
    eq(blueprint.id, blueprintId),
    eq(blueprint.workstationId, workstationId)
  ));

  // const data = {
  //   id,
  //   blueprintId,
  //   clear: true,
  //   lines: [
  //     { x0: 100, y0: 100, x1: 600, y1: 120, thickness: 6, color: "#FF0000" },
  //     { x0: 200, y0: 300, x1: 800, y1: 700, thickness: 3, color: "#00FF88" },
  //     { x0: 50, y0: 900, x1: 1200, y1: 200, thickness: 10, color: "#3366FF" },
  //   ],
  // };

  return NextResponse.json(data);
}
