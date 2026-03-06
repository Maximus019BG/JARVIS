import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function readEnvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const result = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      "DATABASE_URL is missing. Set it in environment or web/.env",
    );
  }

  const envValues = readEnvFile(envPath);
  const databaseUrl = envValues.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL not found in web/.env");
  }

  return databaseUrl;
}

function loadJournal() {
  const journalPath = path.join(
    projectRoot,
    "drizzle",
    "meta",
    "_journal.json",
  );
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));

  if (!Array.isArray(journal.entries)) {
    throw new Error(
      "Invalid drizzle/meta/_journal.json: missing entries array",
    );
  }

  return journal.entries;
}

function loadMigrationRecords(entries) {
  const migrationDir = path.join(projectRoot, "drizzle");

  return entries.map((entry) => {
    const fileName = `${entry.tag}.sql`;
    const filePath = path.join(migrationDir, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing migration file: drizzle/${fileName}`);
    }

    const sqlText = fs.readFileSync(filePath, "utf8");
    const hash = crypto.createHash("sha256").update(sqlText).digest("hex");

    return {
      tag: entry.tag,
      createdAt: Number(entry.when),
      hash,
    };
  });
}

async function main() {
  const databaseUrl = loadDatabaseUrl();
  const records = loadMigrationRecords(loadJournal());
  const sql = postgres(databaseUrl, {
    ssl: "require",
    max: 1,
    connect_timeout: 15,
  });

  try {
    await sql`create schema if not exists drizzle`;
    await sql`
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `;

    let inserted = 0;

    for (const record of records) {
      const result = await sql`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        select ${record.hash}, ${record.createdAt}
        where not exists (
          select 1
          from drizzle.__drizzle_migrations
          where hash = ${record.hash} or created_at = ${record.createdAt}
        )
      `;

      if (result.count > 0) {
        inserted += 1;
        console.log(`Inserted baseline migration: ${record.tag}`);
      }
    }

    const [countRow] =
      await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
    console.log(
      `Baseline complete. Inserted ${inserted} row(s). Ledger total: ${countRow.count}.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
