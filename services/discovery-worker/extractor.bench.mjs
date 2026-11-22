import { performance } from "node:perf_hooks";
import { extractStructuredFacts } from "./extractor.mjs";

const requestedIterations = Number(process.env.E05_BENCH_ITERATIONS || 500);
const iterations = Number.isFinite(requestedIterations)
  ? Math.max(50, Math.min(5000, Math.floor(requestedIterations)))
  : 500;
const hash = "a".repeat(64);
const source = {
  allowed_fields: ["legal_name","registration_id","public_email","website","turnover"],
  field_schema: {
    legal_name: { type: "string", aliases: ["legal_name","legalName"], entityKind: "organization" },
    registration_id: { type: "identifier", aliases: ["registration_id","registrationNumber"] },
    public_email: { type: "email", aliases: ["public_email","email"] },
    website: { type: "url", aliases: ["website"] },
    turnover: { type: "currency", aliases: ["turnover"] }
  }
};

const record = index => ({
  legal_name: "Synthetic Company " + index,
  registration_id: "U" + String(index).padStart(5,"0") + "KA2020PLC123456",
  public_email: "contact" + index + "@example.test",
  website: "https://company" + index + ".example.test/",
  turnover: "INR 12,50,000"
});

const jsonRecords = Array.from({length:60},(_,i)=>record(i+1));
const jsonText = JSON.stringify({ records: jsonRecords });
const htmlRows = jsonRecords.map(item =>
  "<tr><th>legal_name</th><td>" + item.legal_name + "</td></tr>" +
  "<tr><th>registration_id</th><td>" + item.registration_id + "</td></tr>" +
  "<tr><th>public_email</th><td>" + item.public_email + "</td></tr>" +
  "<tr><th>website</th><td>" + item.website + "</td></tr>" +
  "<tr><th>turnover</th><td>" + item.turnover + "</td></tr>"
).join("");
const htmlText = "<!doctype html><html><head><title>Synthetic registry</title></head><body><table>" + htmlRows + "</table></body></html>";
const escapeHtml = value => String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const multiColumnHeaders = ["legal_name","registration_id","public_email","website","turnover"];
const multiColumnHeaderRow = "<tr>" + multiColumnHeaders.map(header => "<td>" + header + "</td>").join("") + "</tr>";
const multiColumnRows = jsonRecords.map(item =>
  "<tr>" + [
    item.legal_name,
    item.registration_id,
    item.public_email,
    item.website,
    item.turnover
  ].map(value => "<td>" + escapeHtml(value) + "</td>").join("") + "</tr>"
).join("");
const htmlMultiColumnText = "<!doctype html><html><head><title>Synthetic company registry</title></head><body><table><tbody>" +
  multiColumnHeaderRow + multiColumnRows + "</tbody></table></body></html>";
const xmlText = "<registry>" + jsonRecords.map(item =>
  "<record>" + Object.entries(item).map(([key,value]) => "<" + key + ">" + value + "</" + key + ">").join("") + "</record>"
).join("") + "</registry>";
const textText = jsonRecords.map(item => Object.entries(item).map(([key,value]) => key + ": " + value).join("\n")).join("\n");
const csvText = [
  "legal_name,registration_id,public_email,website,turnover",
  ...jsonRecords.map(item => [
    '"' + item.legal_name.replace(/"/g,'""') + '"',
    item.registration_id,
    item.public_email,
    item.website,
    '"' + item.turnover + '"'
  ].join(","))
].join("\n");

const cases = [
  ["JSON", "application/json", Buffer.from(jsonText)],
  ["HTML key/value", "text/html", Buffer.from(htmlText)],
  ["HTML multi-column", "text/html", Buffer.from(htmlMultiColumnText)],
  ["XML", "application/xml", Buffer.from(xmlText)],
  ["Text", "text/plain", Buffer.from(textText)],
  ["CSV", "text/csv", Buffer.from(csvText)]
];

function percentile(values, fraction) {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(fraction*sorted.length)-1))] || 0;
}

for (const [name, contentType, bytes] of cases) {
  for (let warm = 0; warm < 10; warm += 1) {
    await extractStructuredFacts({ bytes, contentType, source, contentHash: hash });
  }
  const heapBefore = process.memoryUsage().heapUsed;
  const durations = [];
  let totalFacts = 0;
  const start = performance.now();
  for (let index=0; index<iterations; index+=1) {
    const tick = performance.now();
    const result = await extractStructuredFacts({ bytes, contentType, source, contentHash: hash });
    durations.push(performance.now()-tick);
    totalFacts += result.facts.length;
  }
  const elapsed = performance.now()-start;
  const heapAfter = process.memoryUsage().heapUsed;
  const seconds = elapsed/1000;
  process.stdout.write(JSON.stringify({
    parser:name,
    iterations,
    evidenceBytes:bytes.length,
    elapsedMs:Number(elapsed.toFixed(2)),
    opsPerSecond:Number((iterations/seconds).toFixed(2)),
    factsPerSecond:Number((totalFacts/seconds).toFixed(2)),
    bytesPerSecond:Number((bytes.length*iterations/seconds).toFixed(2)),
    meanMs:Number((elapsed/iterations).toFixed(4)),
    p95Ms:Number(percentile(durations,0.95).toFixed(4)),
    heapDeltaBytes:heapAfter-heapBefore
  })+"\n");
}
