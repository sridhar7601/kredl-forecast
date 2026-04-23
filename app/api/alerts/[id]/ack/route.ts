import { NextResponse } from "next/server";
import { db } from "@/lib/db";

async function ack(id: string) {
  return db.alert.update({
    where: { id },
    data: { acknowledged: true },
  });
}

export async function PUT(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await ack(id);
  return NextResponse.json(row);
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ack(id);
  return NextResponse.redirect(new URL("/alerts", "http://localhost:3000"));
}
