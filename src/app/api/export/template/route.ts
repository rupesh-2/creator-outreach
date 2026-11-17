import { CSV_TEMPLATE_HEADERS } from "@/lib/ingestion/csv";

export function GET() {
  const example = [
    "instagram,example_handle,Example Name,Meal prep for busy nurses | biz: hi@example.com,24000,350,410,,,meal prep,,,,,,https://www.instagram.com/p/XXXX/,5 freezer lunches,2026-11-01,18000,1400,60",
  ];
  return new Response([CSV_TEMPLATE_HEADERS.join(","), ...example].join("\n"), {
    headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="creators-template.csv"' },
  });
}
