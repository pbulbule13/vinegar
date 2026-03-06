import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
export const dynamic = 'force-dynamic';

const LOCATION_KEYS = ["home_location", "work_location", "home_zip", "weather_city"] as const;

export async function GET() {
  const result: Record<string, string> = {};
  for (const key of LOCATION_KEYS) {
    result[key] = getSetting(key) || "";
  }
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    for (const key of LOCATION_KEYS) {
      if (key in body && typeof body[key] === "string") {
        const value = body[key].trim();

        // Length limit for all location fields
        if (value.length > 500) {
          return NextResponse.json({ error: `${key} is too long` }, { status: 400 });
        }

        // Validate ZIP code format
        if (key === "home_zip" && value && !/^\d{5}(-\d{4})?$/.test(value)) {
          return NextResponse.json({ error: "Invalid ZIP code format" }, { status: 400 });
        }

        setSetting(key, value);
      }
    }

    // Clear cached geocode when home location changes
    if ("home_location" in body) {
      setSetting("home_lat", "");
      setSetting("home_lng", "");
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to save location settings" }, { status: 500 });
  }
}
