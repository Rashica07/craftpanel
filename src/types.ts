export type ServerType = "fabric" | "forge" | "paper" | "spigot" | "vanilla" | "bedrock";

export interface JavaInfo {
  path: string;
  raw: string;
  major: number;
  is_64bit: boolean;
}

export interface DetectionResult {
  path: string;
  detected: boolean;
  server_type: ServerType | null;
  server_type_label: string | null;
  launch_target: string | null;
  mc_version: string | null;
  evidence: string[];
  java: JavaInfo | null;
  warnings: string[];
}

export interface ServerRecord {
  id: string;
  name: string;
  path: string;
  server_type: ServerType;
  launch_target: string;
  mc_version: string | null;
  java_path: string;
  ram_mb: number;
  created_at: number;
  sync_code: string | null;
  keep_awake: boolean;
}

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface R2Status {
  configured: boolean;
  config: R2Config | null;
}

export interface CloudStatus {
  exists: boolean;
  locked: boolean;
  heldByUs: boolean;
  holderName: string | null;
  expiresIn: number | null;
  localAhead: boolean;
  cloudAhead: boolean;
}

export interface NewServer {
  name: string;
  path: string;
  server_type: ServerType;
  launch_target: string;
  mc_version: string | null;
  java_path: string;
  ram_mb: number;
}

export type ServerStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "crashed"
  | "unknown";

export interface ProcSnapshot {
  serverId: string;
  status: ServerStatus;
  pid: number | null;
  exitCode: number | null;
  startedAt: number | null;
  stopRequested: boolean;
  needsEula: boolean;
  reattached: boolean;
}

export interface LogLine {
  server_id: string;
  seq: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface SystemInfo {
  total_ram_mb: number;
  available_ram_mb: number;
  suggested_max_mb: number;
  cpu_count: number;
}

export interface ExternalStatus {
  portOpen: boolean;
  port: number;
}

export interface RconSettings {
  enabled: boolean;
  port: number;
  hasPassword: boolean;
  broadcastToOps: boolean;
  propertiesPresent: boolean;
}

export interface RconSetupResult {
  changed: string[];
  port: number;
  restartRequired: boolean;
}

export interface PlayerList {
  online: number;
  max: number;
  players: string[];
}

export type Loader = "vanilla" | "paper" | "fabric" | "neoforge" | "forge" | "bedrock";

export interface VersionInfo {
  id: string;
  kind: string; // "release" | "snapshot" | "beta" | ...
}

export interface CreateSpec {
  loader: Loader;
  mc_version: string;
  loader_version: string | null;
  dir: string;
  name: string;
  ram_mb: number;
  java_path: string | null;
  accept_eula: boolean;
  seed?: string | null;
  gamemode?: string | null;
  difficulty?: string | null;
  motd?: string | null;
  max_players?: number | null;
}

/** A search hit from Modrinth's modpack search — passed through mostly
 * as-is from their API (see commands.rs::modpack_search), not remapped to
 * camelCase like the rest of this app's types. */
export interface ModpackHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  display_categories?: string[];
}

export interface ModpackInfo {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  mcVersion: string | null;
  loader: string | null;
}

export interface ModpackSpec {
  project_id: string;
  dir: string;
  name: string;
  ram_mb: number;
  java_path: string | null;
  accept_eula: boolean;
}

export interface World {
  name: string;
  active: boolean;
  sizeBytes: number;
  seed: string | null;
  hasNether: boolean;
  hasEnd: boolean;
}

export interface WorldInfo {
  active: string;
  worlds: World[];
}

export interface PlayerStat {
  name: string;
  firstSeen: number;
  lastSeen: number;
  sessions: number;
  totalSecs: number;
  lastIp: string | null;
  online: boolean;
}

export interface TimedCommand {
  at: string;
  command: string;
}

export interface ConcurrentPoint {
  ts: number;
  count: number;
}

export interface MetricPoint {
  ts: number;
  ramMb: number | null;
  cpuPct: number | null;
  tps: number | null;
}

export type PluginFieldKind = "bool" | "int" | "text" | "select";

export interface PluginConfigField {
  key: string;
  label: string;
  hint: string;
  kind: PluginFieldKind;
  options: string[];
  min: number | null;
  max: number | null;
  value: string | null;
}

export interface PluginConfigView {
  plugin: string;
  name: string;
  file: string;
  fields: PluginConfigField[];
}

export interface Schedule {
  restartOnCrash: boolean;
  maxCrashRestarts: number;
  scheduledStart: string | null;
  dailyRestart: string | null;
  restartWarningSecs: number;
  timedCommands: TimedCommand[];
  backupOnStop: boolean;
  intervalBackupHours: number | null;
  cloudBackup: boolean;
}

export interface ModrinthHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  iconUrl: string | null;
  projectType: string;
  categories: string[];
  installed: boolean;
  compatible: boolean;
  serverSide: string;
  clientSide: string;
}

export interface ModrinthSearch {
  hits: ModrinthHit[];
  total: number;
}

export interface ModrinthUpdate {
  versionId: string;
  versionNumber: string;
}

export interface ModrinthInstalled {
  projectId: string;
  slug: string;
  title: string;
  filename: string;
  versionId: string;
  versionNumber: string;
  dependency: boolean;
  update: ModrinthUpdate | null;
}

export interface ModrinthInstallResult {
  installed: string[];
  skipped: string[];
}

export interface AntiCheatRecommendation {
  name: string;
  slug: string;
  blurb: string;
}

export interface AntiCheatAdvice {
  installed: string[];
  recommended: AntiCheatRecommendation[];
  public: boolean;
  warn: boolean;
  supported: boolean;
}

export interface Suspicion {
  name: string;
  flags: number;
  rejoins: number;
  samples: string[];
}

export interface AppSettings {
  defaultJava: string;
  defaultRamMb: number;
  expertMode: boolean;
  keepServersOnQuit: boolean;
  githubRepo: string;
  discordWebhookUrl: string;
  stayAwakeOnPower: boolean;
}

export interface UpdateCheck {
  current: string;
  latest: string | null;
  newer: boolean;
  url: string | null;
  notes: string | null;
  unavailable: string | null;
}

export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  allOk: boolean;
}

export interface MgmtStatus {
  supported: boolean;
  enabled: boolean;
  host: string;
  port: number;
  tls: boolean;
  secretSet: boolean;
  reachable: boolean;
}

export interface PerfSample {
  ramMb: number | null;
  cpuPct: number | null;
  tps: number | null;
  mspt: number | null;
  source: string | null;
}

export interface CrashReport {
  file: string;
  time: string | null;
  mtime: number;
  description: string | null;
  headline: string | null;
  suspect: string | null;
  missingDependency: { modId: string; requestedBy: string } | null;
}

export interface JvmInfo {
  args: string | null;
  resolved: string;
  aikar: string;
}

export interface TunnelStatus {
  running: boolean;
  address: string | null;
  error: string | null;
}

export interface CrossplayStatus {
  compatible: boolean;
  geyser: boolean;
  floodgate: boolean;
  bedrockPort: number;
  folder: string;
}

export interface JoinInfo {
  port: number;
  lanIp: string | null;
  lanAddress: string | null;
  publicIp: string | null;
  publicAddress: string | null;
  upnpAvailable: boolean;
  upnpMapped: boolean;
  likelyCgnat: boolean;
  tunnelAddress: string | null;
  recommended: string | null;
}

export interface RemoteApiStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
}

export interface ProvisionProgress {
  stage: string;
  message: string;
  pct: number | null;
}

export const LOADER_META: Record<
  Loader,
  { label: string; blurb: string }
> = {
  vanilla: { label: "Vanilla", blurb: "Mojang's unmodified server" },
  paper: { label: "Paper", blurb: "Fast, plugin-ready (Bukkit/Spigot API)" },
  fabric: { label: "Fabric", blurb: "Lightweight mod loader" },
  neoforge: { label: "NeoForge", blurb: "Modern Forge fork" },
  forge: { label: "Forge", blurb: "The original mod loader" },
  bedrock: { label: "Bedrock", blurb: "For phone, console & Windows-edition players" },
};

export interface SettingField {
  key: string;
  label: string;
  value: string;
  kind: "bool" | "int" | "enum" | "text";
  options: string[];
  help: string | null;
  note: string | null;
}

export interface ServerSettings {
  present: boolean;
  common: SettingField[];
  advanced: SettingField[];
  all: [string, string][];
}

export interface ApplyResult {
  changed: string[];
  restartRequired: boolean;
}

export interface Backup {
  id: string;
  createdAt: number;
  sizeBytes: number;
  label: string | null;
  trigger: "manual" | "pre-restore" | "scheduled";
}

export interface BackupsConfig {
  keep: number;
}

export interface FileEntry {
  name: string;
  rel: string;
  isDir: boolean;
  size: number;
  modified: number;
}

export interface Listing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

export interface FileView {
  rel: string;
  text: string;
  bytes: number;
  truncated: boolean;
  binary: boolean;
}

export interface BannedEntry {
  name: string;
  reason: string | null;
}

export interface AdminLists {
  ops: string[];
  whitelist: string[];
  banned: BannedEntry[];
  bannedIps: string[];
  whitelistOn: boolean;
  enforceWhitelist: boolean;
}

export interface ModFile {
  name: string;
  size: number;
  enabled: boolean;
}

export interface ModList {
  supported: boolean;
  mods: ModFile[];
  fabricApiPresent: boolean;
  authMods: string[];
  warnings: string[];
}

export interface ShareInfo {
  code: string;
  name: string;
  created_by: string;
}

export interface ShareView {
  shared: boolean;
  code: string | null;
  locked: boolean;
  heldByUs: boolean;
  holderName: string | null;
  expiresIn: number | null;
}

export type PlayerAction =
  | "kick"
  | "ban"
  | "pardon"
  | "op"
  | "deop"
  | "whitelist-add"
  | "whitelist-remove"
  | "gamemode";

export const STATUS_META: Record<
  ServerStatus,
  { label: string; tone: "neutral" | "ok" | "warn" | "bad" | "accent" }
> = {
  starting: { label: "Starting", tone: "warn" },
  running: { label: "Running", tone: "ok" },
  stopping: { label: "Stopping", tone: "warn" },
  stopped: { label: "Stopped", tone: "neutral" },
  crashed: { label: "Crashed", tone: "bad" },
  unknown: { label: "Unknown", tone: "neutral" },
};

export const SERVER_TYPE_META: Record<
  ServerType,
  { label: string; blurb: string }
> = {
  fabric: { label: "Fabric", blurb: "Lightweight mod loader" },
  forge: { label: "Forge", blurb: "Classic mod loader" },
  paper: { label: "Paper", blurb: "High-performance plugin server" },
  spigot: { label: "Spigot", blurb: "Bukkit plugin server" },
  vanilla: { label: "Vanilla", blurb: "Unmodified Mojang server" },
  bedrock: { label: "Bedrock", blurb: "Native Bedrock Dedicated Server" },
};

/** Servers with no RCON, no mod/plugin loader, and a different world format
 * — the tabs that assume those (Players, Add-ons, Mods, Worlds) don't apply
 * and are hidden rather than shown broken. Console and Settings still work
 * (stdin passthrough and server.properties both carry over). */
export function hasNoRcon(t: ServerType): boolean {
  return t === "bedrock";
}
