import { NextResponse } from "next/server";
import { searchDuckDuckGo, queryInstantAnswer } from "@/lib/search-tools";
import { sanitizeForExternal } from "@/lib/pii-redactor";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query || query.length > 200) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const sanitized = sanitizeForExternal(query);
  if (!sanitized) {
    return NextResponse.json({ error: "Query empty after sanitization" }, { status: 400 });
  }

  const [instant, results] = await Promise.all([
    queryInstantAnswer(sanitized),
    searchDuckDuckGo(sanitized),
  ]);

  return NextResponse.json({
    instantAnswer: instant?.abstract || null,
    source: instant?.source || null,
    sourceUrl: instant?.url || null,
    results: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
  });
}
