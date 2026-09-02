import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import type {
  AdminLists,
  AntiCheatAdvice,
  AppSettings,
  ApplyResult,
  UpdateCheck,
  DoctorReport,
  ModpackHit,
  ModpackInfo,
  ModpackSpec,
  Backup,
  BackupsConfig,
  CloudStatus,
  CrashReport,
  CreateSpec,
  CrossplayStatus,
  MgmtStatus,
  Suspicion,
  DetectionResult,
  ExternalStatus,
  FileView,
  JavaInfo,
  JvmInfo,
  Listing,
  PerfSample,
  Loader,
  LogLine,
  ModList,
  ModrinthInstallResult,
  ModrinthInstalled,
  ModrinthSearch,
  NewServer,
  ConcurrentPoint,
  JoinInfo,
  MetricPoint,
  PlayerAction,
  PlayerList,
  PlayerStat,
  PluginConfigView,
  ProcSnapshot,
  ProvisionProgress,
  R2Config,
  R2Status,
  RconSettings,
  RemoteApiStatus,
  RconSetupResult,
  ResourcePackConfig,
  Schedule,
  ServerRecord,
  ServerSettings,
  ShareInfo,
  ShareView,
  Snapshot,
  SystemInfo,
  TunnelStatus,
  VersionInfo,
  WorldInfo,
} from "./types";

export const api = {
  pickFolder(): Promise<string | null> {
    return open({ directory: true, multiple: false, title: "Select server folder" }) as Promise<
      string | null
    >;
  },
  /** ~/Documents/CraftPanel Servers, created on first use — the default
   * parent folder new-server flows pre-fill so most people never see a
   * folder picker unless they want one. */
  defaultServersDir(): Promise<string> {
    return invoke("default_servers_dir");
  },
  detectServer(path: string): Promise<DetectionResult> {
    return invoke("detect_server", { path });
  },
  detectJava(path?: string): Promise<JavaInfo | null> {
    return invoke("detect_java", { path: path ?? null });
  },
  addServer(server: NewServer): Promise<ServerRecord> {
    return invoke("add_server", { server });
  },
  listServers(): Promise<ServerRecord[]> {
    return invoke("list_servers");
  },
  removeServer(id: string): Promise<void> {
    return invoke("remove_server", { id });
  },

  // Stage 2 — process management
  systemInfo(): Promise<SystemInfo> {
    return invoke("system_info");
  },
  startServer(
    id: string,
    opts: { force?: boolean; acceptEula?: boolean } = {},
  ): Promise<ProcSnapshot> {
    return invoke("start_server", {
      id,
      force: opts.force ?? false,
      acceptEula: opts.acceptEula ?? false,
    });
  },
  checkExternal(id: string): Promise<ExternalStatus> {
    return invoke("check_external", { id });
  },
  eulaState(id: string): Promise<boolean> {
    return invoke("eula_state", { id });
  },

  // Stage 3 — RCON
  rconSettings(id: string): Promise<RconSettings> {
    return invoke("rcon_settings", { id });
  },
  rconSetup(id: string): Promise<RconSetupResult> {
    return invoke("rcon_setup", { id });
  },
  rconPlayers(id: string): Promise<PlayerList> {
    return invoke("rcon_players", { id });
  },
  rconCommand(id: string, command: string): Promise<string> {
    return invoke("rcon_command", { id, command });
  },
  rconPlayerAction(
    id: string,
    action: PlayerAction,
    player: string,
    arg?: string,
  ): Promise<string> {
    return invoke("rcon_player_action", { id, action, player, arg: arg ?? null });
  },
  stopServer(id: string): Promise<void> {
    return invoke("stop_server", { id });
  },
  stopOnPort(id: string): Promise<void> {
    return invoke("stop_on_port", { id });
  },
  killServer(id: string): Promise<void> {
    return invoke("kill_server", { id });
  },
  sendConsole(id: string, line: string): Promise<void> {
    return invoke("send_console", { id, line });
  },
  acceptEula(id: string): Promise<void> {
    return invoke("accept_eula", { id });
  },
  consoleLines(id: string): Promise<LogLine[]> {
    return invoke("console_lines", { id });
  },
  serverRuntime(id: string): Promise<ProcSnapshot> {
    return invoke("server_runtime", { id });
  },
  allRuntimes(): Promise<ProcSnapshot[]> {
    return invoke("all_runtimes");
  },
  setServerRam(id: string, ramMb: number): Promise<void> {
    return invoke("set_server_ram", { id, ramMb });
  },
  setKeepAwake(id: string, keepAwake: boolean): Promise<void> {
    return invoke("set_keep_awake", { id, keepAwake });
  },

  // Stage 2.5 — create server
  loaderVersions(loader: Loader): Promise<VersionInfo[]> {
    return invoke("loader_versions", { loader });
  },
  createServer(spec: CreateSpec): Promise<ServerRecord> {
    return invoke("create_server", { spec });
  },
  cloneServer(id: string, newName: string, newDir: string): Promise<ServerRecord> {
    return invoke("clone_server", { id, newName, newDir });
  },
  changeServerVersion(
    id: string,
    loader: Loader,
    mcVersion: string,
    loaderVersion?: string,
  ): Promise<ServerRecord> {
    return invoke("change_server_version", { id, loader, mcVersion, loaderVersion: loaderVersion ?? null });
  },
  onProvisionProgress(fn: (p: ProvisionProgress) => void): Promise<UnlistenFn> {
    return listen<ProvisionProgress>("provision:progress", (e) => fn(e.payload));
  },
  modpackSearch(query: string): Promise<ModpackHit[]> {
    return invoke("modpack_search", { query });
  },
  modpackInfo(projectId: string): Promise<ModpackInfo> {
    return invoke("modpack_info", { projectId });
  },
  createServerFromModpack(spec: ModpackSpec): Promise<ServerRecord> {
    return invoke("create_server_from_modpack", { spec });
  },

  // Stage 4 — settings + mods
  getSettings(id: string): Promise<ServerSettings> {
    return invoke("get_settings", { id });
  },
  applySettings(id: string, changes: [string, string][]): Promise<ApplyResult> {
    return invoke("apply_settings", { id, changes });
  },
  listMods(id: string): Promise<ModList> {
    return invoke("list_mods", { id });
  },
  setModEnabled(id: string, name: string, enable: boolean): Promise<void> {
    return invoke("set_mod_enabled", { id, name, enable });
  },
  removeMod(id: string, name: string): Promise<void> {
    return invoke("remove_mod", { id, name });
  },
  importMods(id: string, sources: string[]): Promise<string[]> {
    return invoke("import_mods", { id, sources });
  },
  pickJars(): Promise<string[] | null> {
    return open({
      multiple: true,
      filters: [{ name: "Mod jars", extensions: ["jar"] }],
      title: "Choose mod .jar files",
    }) as Promise<string[] | null>;
  },

  // Stage 6.1 — backups
  backupNow(id: string, label?: string): Promise<Backup> {
    return invoke("backup_now", { id, label: label?.trim() || null });
  },
  listBackups(id: string): Promise<Backup[]> {
    return invoke("list_backups", { id });
  },
  cloudBackups(id: string): Promise<Backup[]> {
    return invoke("cloud_backups", { id });
  },
  deleteBackup(id: string, backupId: string): Promise<void> {
    return invoke("delete_backup", { id, backupId });
  },
  restoreBackup(id: string, backupId: string): Promise<void> {
    return invoke("restore_backup", { id, backupId });
  },
  getBackupsConfig(): Promise<BackupsConfig> {
    return invoke("get_backups_config");
  },
  setBackupsKeep(keep: number): Promise<void> {
    return invoke("set_backups_keep", { keep });
  },
  onBackupProgress(
    fn: (p: { serverId: string; message: string }) => void,
  ): Promise<UnlistenFn> {
    return listen<{ serverId: string; message: string }>("backup:progress", (e) =>
      fn(e.payload),
    );
  },

  // Time Machine snapshots — reuses the "backup:progress" event for restore
  // progress, same mechanism as the zip backups above.
  snapshotNow(id: string): Promise<Snapshot> {
    return invoke("snapshot_now", { id });
  },
  listSnapshots(id: string): Promise<Snapshot[]> {
    return invoke("list_snapshots", { id });
  },
  restoreSnapshot(id: string, snapshotId: string): Promise<void> {
    return invoke("restore_snapshot", { id, snapshotId });
  },
  deleteSnapshot(id: string, snapshotId: string): Promise<void> {
    return invoke("delete_snapshot", { id, snapshotId });
  },

  // Stage 4.7 — files + logs + admin
  fsList(id: string, path: string): Promise<Listing> {
    return invoke("fs_list", { id, path });
  },
  fsRead(id: string, path: string): Promise<FileView> {
    return invoke("fs_read", { id, path });
  },
  fsWrite(id: string, path: string, content: string): Promise<void> {
    return invoke("fs_write", { id, path, content });
  },
  fsMkdir(id: string, path: string): Promise<void> {
    return invoke("fs_mkdir", { id, path });
  },
  fsRename(id: string, from: string, to: string): Promise<void> {
    return invoke("fs_rename", { id, from, to });
  },
  fsDelete(id: string, path: string): Promise<void> {
    return invoke("fs_delete", { id, path });
  },
  async fsImport(id: string, dir: string): Promise<string[] | null> {
    const picked = (await open({ multiple: true, title: "Choose files to upload" })) as
      | string[]
      | null;
    if (!picked?.length) return null;
    return invoke("fs_import", { id, dir, sources: picked });
  },
  /** Same command as fsImport, but for real filesystem paths handed over
   * by an OS drag-and-drop instead of the file dialog — no dialog to skip. */
  fsImportPaths(id: string, dir: string, paths: string[]): Promise<string[]> {
    return invoke("fs_import", { id, dir, sources: paths });
  },
  async fsExport(id: string, path: string): Promise<boolean> {
    const name = path.split("/").pop() || "download";
    const dest = await save({ defaultPath: name, title: "Save file as" });
    if (!dest) return false;
    await invoke("fs_export", { id, path, dest });
    return true;
  },
  tailLog(id: string, file?: string, lines?: number): Promise<string> {
    return invoke("tail_log", { id, file: file ?? null, lines: lines ?? null });
  },
  adminLists(id: string): Promise<AdminLists> {
    return invoke("admin_lists", { id });
  },
  playerHistory(id: string): Promise<PlayerStat[]> {
    return invoke("player_history", { id });
  },
  playerActivity(id: string, since: number, bucketSecs: number): Promise<ConcurrentPoint[]> {
    return invoke("player_activity", { id, since, bucketSecs });
  },
  metricsHistory(id: string, since: number): Promise<MetricPoint[]> {
    return invoke("metrics_history", { id, since });
  },
  pluginConfigViews(id: string): Promise<PluginConfigView[]> {
    return invoke("plugin_config_views", { id });
  },
  setPluginConfig(id: string, plugin: string, key: string, value: string): Promise<void> {
    return invoke("set_plugin_config", { id, plugin, key, value });
  },

  // App lock (local PIN)
  lockStatus(): Promise<boolean> {
    return invoke("lock_status");
  },
  lockSet(pin: string): Promise<void> {
    return invoke("lock_set", { pin });
  },
  lockCheck(pin: string): Promise<boolean> {
    return invoke("lock_check", { pin });
  },
  lockClear(currentPin: string): Promise<void> {
    return invoke("lock_clear", { currentPin });
  },

  // Remote API (Android companion app)
  remoteApiStatus(): Promise<RemoteApiStatus> {
    return invoke("remote_api_status");
  },
  remoteApiSetEnabled(enabled: boolean): Promise<RemoteApiStatus> {
    return invoke("remote_api_set_enabled", { enabled });
  },
  remoteApiRegenerateToken(): Promise<RemoteApiStatus> {
    return invoke("remote_api_regenerate_token");
  },
  remoteApiPairPayload(): Promise<string> {
    return invoke("remote_api_pair_payload");
  },

  // Stage 5 — networking / join address
  netInfo(id: string): Promise<JoinInfo> {
    return invoke("net_info", { id });
  },
  setTunnelAddress(id: string, address: string | null): Promise<void> {
    return invoke("set_tunnel_address", { id, address });
  },
  tunnelStart(id: string): Promise<void> {
    return invoke("tunnel_start", { id });
  },
  tunnelStop(id: string): Promise<void> {
    return invoke("tunnel_stop", { id });
  },
  tunnelStatus(id: string): Promise<TunnelStatus> {
    return invoke("tunnel_status", { id });
  },
  onTunnelStatus(fn: (id: string, s: TunnelStatus) => void): Promise<UnlistenFn> {
    return listen<[string, TunnelStatus]>("tunnel:status", (e) => fn(e.payload[0], e.payload[1]));
  },
  onTunnelProgress(fn: (msg: string) => void): Promise<UnlistenFn> {
    return listen<string>("tunnel:progress", (e) => fn(e.payload));
  },
  upnpForward(id: string): Promise<string> {
    return invoke("upnp_forward", { id });
  },
  upnpRemove(id: string): Promise<void> {
    return invoke("upnp_remove", { id });
  },
  qrSvg(text: string): Promise<string> {
    return invoke("qr_svg", { text });
  },
  crossplayStatus(id: string): Promise<CrossplayStatus> {
    return invoke("crossplay_status", { id });
  },
  crossplayEnable(id: string): Promise<CrossplayStatus> {
    return invoke("crossplay_enable", { id });
  },
  crossplayDisable(id: string): Promise<void> {
    return invoke("crossplay_disable", { id });
  },
  crossplayForward(id: string): Promise<void> {
    return invoke("crossplay_forward", { id });
  },

  // Stage 6.2 — automation
  getSchedule(id: string): Promise<Schedule> {
    return invoke("get_schedule", { id });
  },
  setSchedule(id: string, schedule: Schedule): Promise<void> {
    return invoke("set_schedule", { id, schedule });
  },

  // Stage 7 — performance / crashes / JVM
  serverPerf(id: string): Promise<PerfSample> {
    return invoke("server_perf", { id });
  },
  latestCrash(id: string): Promise<CrashReport | null> {
    return invoke("latest_crash", { id });
  },
  listCrashes(id: string): Promise<CrashReport[]> {
    return invoke("list_crashes", { id });
  },
  getJvmArgs(id: string): Promise<JvmInfo> {
    return invoke("get_jvm_args", { id });
  },
  setJvmArgs(id: string, args: string | null): Promise<boolean> {
    return invoke("set_jvm_args", { id, args });
  },

  // Stage 8 — Modrinth content browser
  modrinthSearch(
    id: string,
    query: string,
    projectType: string,
    category: string | null = null,
    offset = 0,
  ): Promise<ModrinthSearch> {
    return invoke("modrinth_search", { id, query, projectType, category, offset });
  },
  modrinthInstall(
    id: string,
    projectId: string,
    projectType: string,
  ): Promise<ModrinthInstallResult> {
    return invoke("modrinth_install", { id, projectId, projectType });
  },
  modrinthInstallResourcePack(
    id: string,
    projectId: string,
    prompt: string,
    required: boolean,
  ): Promise<ResourcePackConfig> {
    return invoke("modrinth_install_resourcepack", { id, projectId, prompt, required });
  },
  modrinthInstalled(id: string): Promise<ModrinthInstalled[]> {
    return invoke("modrinth_installed", { id });
  },
  modrinthCheckUpdates(id: string): Promise<ModrinthInstalled[]> {
    return invoke("modrinth_check_updates", { id });
  },
  modrinthUpdate(id: string, projectId: string): Promise<void> {
    return invoke("modrinth_update", { id, projectId });
  },
  modrinthRemove(id: string, projectId: string): Promise<void> {
    return invoke("modrinth_remove", { id, projectId });
  },

  // Stage 9 — anti-cheat + management API
  anticheatAdvice(id: string): Promise<AntiCheatAdvice> {
    return invoke("anticheat_advice", { id });
  },
  anticheatSuspicion(id: string): Promise<Suspicion[]> {
    return invoke("anticheat_suspicion", { id });
  },
  mgmtStatus(id: string): Promise<MgmtStatus> {
    return invoke("mgmt_status", { id });
  },
  mgmtEnable(id: string): Promise<MgmtStatus> {
    return invoke("mgmt_enable", { id });
  },
  mgmtDisable(id: string): Promise<void> {
    return invoke("mgmt_disable", { id });
  },

  // Stage 10 — app settings + updates
  appSettingsGet(): Promise<AppSettings> {
    return invoke("app_settings_get");
  },
  appSettingsSet(settings: AppSettings): Promise<void> {
    return invoke("app_settings_set", { settings });
  },
  checkUpdate(): Promise<UpdateCheck> {
    return invoke("check_update");
  },
  installUpdate(): Promise<void> {
    return invoke("install_update");
  },
  discordTestWebhook(url: string): Promise<void> {
    return invoke("discord_test_webhook", { url });
  },
  onUpdateProgress(fn: (p: ProvisionProgress) => void): Promise<UnlistenFn> {
    return listen<ProvisionProgress>("update:progress", (e) => fn(e.payload));
  },
  relaunchApp(): Promise<void> {
    return relaunch();
  },
  appInstallId(): Promise<string> {
    return invoke("app_install_id");
  },
  doctorCheck(): Promise<DoctorReport> {
    return invoke("doctor_check");
  },

  // Java auto-install — Adoptium Temurin, shared across servers.
  javaOfferableFor(mcVersion: string): Promise<number | null> {
    return invoke("java_offerable_for", { mcVersion });
  },
  javaInstallStatus(feature: number): Promise<JavaInfo | null> {
    return invoke("java_install_status", { feature });
  },
  installJava(feature: number): Promise<JavaInfo> {
    return invoke("install_java", { feature });
  },
  setServerJavaPath(id: string, javaPath: string): Promise<void> {
    return invoke("set_server_java_path", { id, javaPath });
  },
  onJavaInstallProgress(fn: (p: ProvisionProgress) => void): Promise<UnlistenFn> {
    return listen<ProvisionProgress>("java-install:progress", (e) => fn(e.payload));
  },

  // branding + worlds
  serverIconStatus(id: string): Promise<boolean> {
    return invoke("server_icon_status", { id });
  },
  async pickAndSetIcon(id: string): Promise<boolean> {
    const src = (await open({
      multiple: false,
      title: "Choose a server icon (PNG/JPG)",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    })) as string | null;
    if (!src) return false;
    await invoke("set_server_icon", { id, source: src });
    return true;
  },
  clearServerIcon(id: string): Promise<void> {
    return invoke("clear_server_icon", { id });
  },
  listWorlds(id: string): Promise<WorldInfo> {
    return invoke("list_worlds", { id });
  },
  worldSetActive(id: string, name: string): Promise<void> {
    return invoke("world_set_active", { id, name });
  },
  worldCreate(id: string, name: string, seed?: string): Promise<void> {
    return invoke("world_create", { id, name, seed: seed?.trim() || null });
  },
  worldRename(id: string, from: string, to: string): Promise<void> {
    return invoke("world_rename", { id, from, to });
  },
  worldDelete(id: string, name: string): Promise<void> {
    return invoke("world_delete", { id, name });
  },

  // resource pack
  getResourcePack(id: string): Promise<ResourcePackConfig> {
    return invoke("get_resource_pack", { id });
  },
  setResourcePack(id: string, url: string, prompt: string, required: boolean): Promise<ResourcePackConfig> {
    return invoke("set_resource_pack", { id, url, prompt, required });
  },
  clearResourcePack(id: string): Promise<void> {
    return invoke("clear_resource_pack", { id });
  },

  // multi-device sharing
  shareServer(id: string): Promise<ShareInfo> {
    return invoke("share_server", { id });
  },
  unshareServer(id: string): Promise<void> {
    return invoke("unshare_server", { id });
  },
  joinShared(folder: string, code: string): Promise<ServerRecord> {
    return invoke("join_shared", { folder, code });
  },
  shareStatus(id: string): Promise<ShareView> {
    return invoke("share_status", { id });
  },

  // cloud sync (R2)
  r2ConfigGet(): Promise<R2Status> {
    return invoke("r2_config_get");
  },
  r2ConfigSet(config: R2Config): Promise<void> {
    return invoke("r2_config_set", { config });
  },
  r2ConfigClear(): Promise<void> {
    return invoke("r2_config_clear");
  },
  cloudShare(id: string): Promise<string> {
    return invoke("cloud_share", { id });
  },
  cloudJoin(code: string, folder: string): Promise<ServerRecord> {
    return invoke("cloud_join", { code, folder });
  },
  cloudStatus(id: string): Promise<CloudStatus | null> {
    return invoke("cloud_status", { id });
  },
  cloudFinish(id: string): Promise<void> {
    return invoke("cloud_finish", { id });
  },
  cloudUnshare(id: string): Promise<void> {
    return invoke("cloud_unshare", { id });
  },
  onSyncProgress(
    fn: (p: { serverId: string; message: string }) => void,
  ): Promise<UnlistenFn> {
    return listen<{ serverId: string; message: string }>("sync:progress", (e) =>
      fn(e.payload),
    );
  },

  onLog(fn: (line: LogLine) => void): Promise<UnlistenFn> {
    return listen<LogLine>("server:log", (e) => fn(e.payload));
  },
  onStatus(fn: (snap: ProcSnapshot) => void): Promise<UnlistenFn> {
    return listen<ProcSnapshot>("server:status", (e) => fn(e.payload));
  },
};
