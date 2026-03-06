import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const shouldFix = process.argv.includes("--fix");

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

function loadJournalEntries() {
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
    return {
      tag: entry.tag,
      createdAt: Number(entry.when),
      hash: crypto.createHash("sha256").update(sqlText).digest("hex"),
    };
  });
}

async function ensureLedgerTable(sql) {
  await sql`create schema if not exists drizzle`;
  await sql`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `;
}

async function findMissingMigrations(sql, records) {
  const dbRows = await sql`
    select hash, created_at
    from drizzle.__drizzle_migrations
  `;

  const hashSet = new Set(dbRows.map((row) => row.hash));
  const createdAtSet = new Set(dbRows.map((row) => Number(row.created_at)));

  return records.filter(
    (record) =>
      !hashSet.has(record.hash) && !createdAtSet.has(record.createdAt),
  );
}

async function baselineMissing(sql, missingRecords) {
  let inserted = 0;

  for (const record of missingRecords) {
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

  return inserted;
}

async function main() {
  const databaseUrl = loadDatabaseUrl();
  const journalEntries = loadJournalEntries();
  const records = loadMigrationRecords(journalEntries);
  const sql = postgres(databaseUrl, {
    ssl: "require",
    max: 1,
    connect_timeout: 15,
  });

  try {
    await ensureLedgerTable(sql);

    const missingBefore = await findMissingMigrations(sql, records);
    if (missingBefore.length === 0) {
      console.log(
        "DB Doctor: OK. Migration ledger is in sync with local drizzle journal.",
      );
      return;
    }

    console.log(
      `DB Doctor: Found ${missingBefore.length} missing migration ledger row(s).`,
    );
    console.log(
      `Missing tags: ${missingBefore.map((row) => row.tag).join(", ")}`,
    );

    if (!shouldFix) {
      console.log(
        "Run `pnpm db:doctor -- --fix` to baseline missing rows safely.",
      );
      process.exit(1);
    }

    const inserted = await baselineMissing(sql, missingBefore);
    const missingAfter = await findMissingMigrations(sql, records);

    if (missingAfter.length > 0) {
      console.log(
        `DB Doctor: Partial fix. ${missingAfter.length} migration(s) still missing.`,
      );
      process.exit(1);
    }

    console.log(`DB Doctor: Fixed. Inserted ${inserted} ledger row(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
