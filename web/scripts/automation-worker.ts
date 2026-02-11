import { runWorkerLoop } from "~/server/automations/runner";

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  return {
    once: args.has("--once"),
    intervalMs: (() => {
      const prefix = "--interval=";
      const found = argv.find((a) => a.startsWith(prefix));
      if (!found) return undefined;
      const n = Number(found.slice(prefix.length));
      return Number.isFinite(n) ? n : undefined;
    })(),
    workerId: (() => {
      const prefix = "--worker-id=";
      const found = argv.find((a) => a.startsWith(prefix));
      return found ? found.slice(prefix.length) : undefined;
    })(),
  };
}

async function main() {
  const { once, intervalMs, workerId } = parseArgs(process.argv.slice(2));

  const res = await runWorkerLoop({
    once,
    pollIntervalMs: intervalMs,
    workerId,
  });

  if (once) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res));
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
