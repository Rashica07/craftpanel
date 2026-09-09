/**
 * Hardware overheating watch. Every 60s: read CPU + GPU temperatures via
 * `systeminformation` and, if either is over the threshold, POST an urgent
 * embed to the Discord webhook with an @owner ping so a phone actually buzzes.
 *
 * Guards:
 *  - if no WEBHOOK_URL is set the whole thing is a no-op,
 *  - many Macs/VMs report no usable sensor data; after a few empty reads we
 *    log once and stop polling instead of spamming the console,
 *  - one alert then silence for ALERT_COOLDOWN_MIN, re-armed once things cool.
 */
import si from "systeminformation";
import { config } from "./config.js";

const POLL_MS = 60_000;

let lastAlertAt = 0;
let overheating = false;
let emptyReads = 0;

interface Temps {
  cpu: number | null;
  gpu: number | null;
}

async function readTemps(): Promise<Temps> {
  const [cpuT, graphics] = await Promise.all([
    si.cpuTemperature().catch(() => null),
    si.graphics().catch(() => null),
  ]);

  const cpu = cpuT && typeof cpuT.main === "number" && cpuT.main > 0 ? cpuT.main : null;

  let gpu: number | null = null;
  for (const c of graphics?.controllers ?? []) {
    if (typeof c.temperatureGpu === "number" && c.temperatureGpu > 0) {
      gpu = Math.max(gpu ?? 0, c.temperatureGpu);
    }
  }
  return { cpu, gpu };
}

async function postWebhook(payload: unknown): Promise<void> {
  if (!config.monitor.webhookUrl) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    await fetch(config.monitor.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    console.error("[monitor] webhook post failed:", (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

async function tick(): Promise<void> {
  let temps: Temps;
  try {
    temps = await readTemps();
  } catch (e) {
    console.error("[monitor] temperature read threw:", (e as Error).message);
    return;
  }

  if (temps.cpu === null && temps.gpu === null) {
    emptyReads += 1;
    if (emptyReads === 3) {
      console.log("[monitor] no temperature sensors readable on this machine — overheating alerts disabled");
    }
    return;
  }
  emptyReads = 0;

  const hot = Math.max(temps.cpu ?? 0, temps.gpu ?? 0);
  const threshold = config.monitor.thresholdC;

  if (hot >= threshold) {
    const now = Date.now();
    if (!overheating || now - lastAlertAt >= config.monitor.cooldownMs) {
      overheating = true;
      lastAlertAt = now;
      const ping = config.discord.ownerId ? `<@${config.discord.ownerId}> ` : "";
      await postWebhook({
        content: `${ping}⚠️ **Overheating** — ${hot.toFixed(0)}°C (limit ${threshold}°C)`,
        embeds: [
          {
            title: "Hardware temperature alert",
            color: 0xdc2626,
            fields: [
              { name: "CPU", value: temps.cpu !== null ? `${temps.cpu.toFixed(0)}°C` : "n/a", inline: true },
              { name: "GPU", value: temps.gpu !== null ? `${temps.gpu.toFixed(0)}°C` : "n/a", inline: true },
              { name: "Threshold", value: `${threshold}°C`, inline: true },
            ],
            footer: { text: "Check cooling or stop a server." },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }
  } else if (overheating && hot < threshold - 5) {
    // hysteresis: only "recovered" once it's clearly back down
    overheating = false;
    await postWebhook({ content: `✅ Temperatures back to normal — ${hot.toFixed(0)}°C.` });
  }
}

export function startMonitor(): NodeJS.Timeout | null {
  if (!config.monitor.webhookUrl) {
    console.log("[monitor] WEBHOOK_URL not set — overheating alerts disabled");
    return null;
  }
  void tick();
  return setInterval(() => void tick(), POLL_MS);
}
