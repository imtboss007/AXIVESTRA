import { mkdir, writeFile } from "node:fs/promises";

const config = {
  identities: [{
    name: "axivestra-local-prototype",
    credentials: [{
      accessKey: process.env.S3_ACCESS_KEY || "axivestra-local-s3-user",
      secretKey: process.env.S3_SECRET_KEY || "axivestra-local-s3-secret-change-me"
    }],
    actions: ["Admin", "Read", "Write", "List", "Tagging"]
  }]
};
const output = process.env.S3_CONFIG_OUTPUT || "/config/s3.json";
await mkdir("/config", { recursive: true });
await writeFile(output, JSON.stringify(config, null, 2), { mode: 0o440 });
process.stdout.write("Wrote local-only SeaweedFS S3 configuration.\n");
