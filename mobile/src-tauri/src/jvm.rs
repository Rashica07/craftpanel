//! Embeds a *second*, independent JVM inside this Android app's own process
//! — not Android's own app runtime (ART), which can't run a desktop
//! Minecraft server jar at all. This is a genuine HotSpot JVM
//! (`libjvm.so`, a real Termux-built OpenJDK 21 for `aarch64`, vendored
//! into `jniLibs/` + `assets/`), created via the same `JNI_CreateJavaVM`
//! entry point any native host embeds a JVM through — Minecraft's own
//! server jar has no idea it isn't running under a normal `java` launcher.
//!
//! Two facts about Android specifically drove this design, not a plain
//! `std::process::Command` spawn of a `java` binary:
//! - Android 10+ won't execute a binary that wasn't shipped inside the
//!   APK itself (`.so` files under `jniLibs/` are the one exception — the
//!   OS extracts those with execute permission at install time; anything
//!   downloaded or unpacked at runtime is blocked). `libjvm.so`/`libjli.so`
//!   already have `.so` names, so they ride along for free; there's no
//!   `bin/java` executable at all in this design, only libraries loaded
//!   via `dlopen`, which sidesteps that restriction entirely.
//! - `libjvm.so` isn't a build-time link dependency (it doesn't exist on
//!   the machine that compiles this app, only on the phone at runtime), so
//!   it's opened dynamically via `libloading` and `JNI_CreateJavaVM` is
//!   called through a raw function pointer — the `jni` crate's own
//!   `JavaVM::new()` convenience assumes static linkage, which doesn't
//!   apply here.

use std::ffi::CString;
use std::os::raw::c_void;
use std::path::{Path, PathBuf};

use jni::objects::{JObject, JString, JValue};
use jni::{AttachGuard, JNIEnv};

use crate::android_vm;

const ASSET_NAME: &str = "jre21-aarch64.tar.gz";
const JRE_DIR_NAME: &str = "java-21-openjdk";

/// The Android `JavaVM` (captured ourselves at library-load time — see
/// `JNI_OnLoad` in `lib.rs`, not `ndk-context`, which this Tauri/wry build
/// never actually initializes; calling it panics with "android context was
/// not initialized", confirmed via a real on-device crash + logcat before
/// this was written) and the process's `Application` context, fetched via
/// `ActivityThread.currentApplication()` — used only to reach
/// `AssetManager`/`ApplicationInfo`, never to touch the guest JVM.
fn android_env() -> Result<(jni::JavaVM, JObject<'static>), String> {
    let vm = android_vm::get()?;
    let mut env = vm.attach_current_thread_permanently().map_err(|e| e.to_string())?;
    let activity_thread = env
        .find_class("android/app/ActivityThread")
        .map_err(|e| format!("find_class(ActivityThread): {e}"))?;
    let app = env
        .call_static_method(activity_thread, "currentApplication", "()Landroid/app/Application;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("ActivityThread.currentApplication(): {e}"))?;
    if app.is_null() {
        return Err("ActivityThread.currentApplication() returned null".to_string());
    }
    // SAFETY: promoting to a global ref so it outlives this JNIEnv borrow;
    // leaked deliberately — this is the one process-wide Application object.
    let global = env.new_global_ref(app).map_err(|e| e.to_string())?;
    let raw = global.as_raw();
    std::mem::forget(global);
    let activity = unsafe { JObject::from_raw(raw) };
    Ok((vm, activity))
}

fn read_asset_bytes(env: &mut JNIEnv, context: &JObject) -> Result<Vec<u8>, String> {
    let assets = env
        .call_method(context, "getAssets", "()Landroid/content/res/AssetManager;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("getAssets: {e}"))?;
    let name = env.new_string(ASSET_NAME).map_err(|e| e.to_string())?;
    let stream = env
        .call_method(&assets, "open", "(Ljava/lang/String;)Ljava/io/InputStream;", &[JValue::from(&name)])
        .and_then(|v| v.l())
        .map_err(|e| format!("AssetManager.open({ASSET_NAME}): {e}"))?;

    let mut out = Vec::new();
    loop {
        let chunk = env.new_byte_array(1 << 16).map_err(|e| e.to_string())?;
        let n = env
            .call_method(&stream, "read", "([B)I", &[JValue::from(&chunk)])
            .and_then(|v| v.i())
            .map_err(|e| format!("InputStream.read: {e}"))?;
        if n <= 0 {
            break;
        }
        let mut buf = vec![0i8; n as usize];
        env.get_byte_array_region(&chunk, 0, &mut buf).map_err(|e| e.to_string())?;
        out.extend(buf.iter().map(|&b| b as u8));
    }
    let _ = env.call_method(&stream, "close", "()V", &[]);
    Ok(out)
}

fn native_lib_dir(env: &mut JNIEnv, context: &JObject) -> Result<String, String> {
    let app_info = env
        .call_method(context, "getApplicationInfo", "()Landroid/content/pm/ApplicationInfo;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("getApplicationInfo: {e}"))?;
    let dir = env
        .get_field(&app_info, "nativeLibraryDir", "Ljava/lang/String;")
        .and_then(|v| v.l())
        .map_err(|e| format!("nativeLibraryDir: {e}"))?;
    let dir: String = env.get_string(&JString::from(dir)).map_err(|e| e.to_string())?.into();
    Ok(dir)
}

/// Unpacks the bundled JRE (conf/, lib/modules, etc — everything except the
/// `.so` files, which the OS already placed in `nativeLibraryDir`) into the
/// app's private data dir, if it isn't there already. Real, normal file
/// I/O — no execute-permission concerns, this is all data the JVM only
/// ever reads.
pub fn prepare_jre_data(app_data_dir: &Path) -> Result<PathBuf, String> {
    let dest = app_data_dir.join(JRE_DIR_NAME);
    let marker = app_data_dir.join(".jre-extracted");
    if marker.is_file() && dest.is_dir() {
        return Ok(dest);
    }

    let (vm, context) = android_env()?;
    let mut env: AttachGuard = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let bytes = read_asset_bytes(&mut env, &context)?;

    let _ = std::fs::remove_dir_all(&dest);
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let gz = flate2::read::GzDecoder::new(std::io::Cursor::new(bytes));
    let mut archive = tar::Archive::new(gz);
    archive.unpack(app_data_dir).map_err(|e| format!("unpacking JRE: {e}"))?;

    if !dest.is_dir() {
        return Err(format!("expected {} after unpacking the JRE tarball", dest.display()));
    }
    std::fs::write(&marker, "1").map_err(|e| e.to_string())?;
    Ok(dest)
}

/// Loads `libjvm.so` from this APK's own native library directory and
/// starts a JVM inside this process. Returns the JNI version string as a
/// proof-of-life — this is the real go/no-go check for the whole approach,
/// before anything is built on top of it to actually launch a server jar.
pub fn smoke_test(app_data_dir: &Path) -> Result<String, String> {
    let jre_home = prepare_jre_data(app_data_dir)?;

    let (vm, context) = android_env()?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let lib_dir = native_lib_dir(&mut env, &context)?;
    let libjvm_path = Path::new(&lib_dir).join("libjvm.so");
    if !libjvm_path.is_file() {
        return Err(format!("{} not found — check jniLibs bundling", libjvm_path.display()));
    }

    // SAFETY: libjvm.so is our own vendored, verified aarch64 Android build
    // (see the module doc comment); loaded exactly once per process.
    let lib = unsafe { libloading::Library::new(&libjvm_path) }
        .map_err(|e| format!("dlopen {}: {e}", libjvm_path.display()))?;
    type CreateVmFn = unsafe extern "system" fn(
        *mut *mut jni::sys::JavaVM,
        *mut *mut c_void,
        *mut c_void,
    ) -> jni::sys::jint;
    let create_vm: libloading::Symbol<CreateVmFn> =
        unsafe { lib.get(b"JNI_CreateJavaVM\0") }.map_err(|e| format!("JNI_CreateJavaVM symbol: {e}"))?;

    let java_home_opt = CString::new(format!("-Djava.home={}", jre_home.display())).unwrap();
    let mut options = [jni::sys::JavaVMOption {
        optionString: java_home_opt.as_ptr() as *mut _,
        extraInfo: std::ptr::null_mut(),
    }];
    let mut args = jni::sys::JavaVMInitArgs {
        version: jni::sys::JNI_VERSION_1_8,
        nOptions: options.len() as i32,
        options: options.as_mut_ptr(),
        ignoreUnrecognized: 0,
    };

    let mut guest_vm: *mut jni::sys::JavaVM = std::ptr::null_mut();
    let mut guest_env: *mut c_void = std::ptr::null_mut();
    // SAFETY: guest_vm/guest_env are valid out-pointers; args lives until
    // this call returns, which is all JNI_CreateJavaVM requires of it.
    let rc = unsafe {
        create_vm(&mut guest_vm, &mut guest_env, &mut args as *mut _ as *mut c_void)
    };
    if rc != jni::sys::JNI_OK as i32 || guest_vm.is_null() {
        return Err(format!("JNI_CreateJavaVM failed with code {rc}"));
    }

    // SAFETY: guest_vm was just successfully created above; from_raw takes
    // ownership of exactly the pointer JNI_CreateJavaVM handed back.
    let guest = unsafe { jni::JavaVM::from_raw(guest_vm) }.map_err(|e| e.to_string())?;
    let mut genv = guest.get_env().map_err(|e| e.to_string())?;
    let system = genv.find_class("java/lang/System").map_err(|e| e.to_string())?;
    let key = genv.new_string("java.version").map_err(|e| e.to_string())?;
    let version = genv
        .call_static_method(
            system,
            "getProperty",
            "(Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::from(&key)],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("System.getProperty: {e}"))?;
    let version: String = genv.get_string(&JString::from(version)).map_err(|e| e.to_string())?.into();

    // Deliberately leaked, not dropped: the guest JVM we just created is
    // still alive (its own internal threads included) using code pages
    // that live inside `lib` — unloading the shared library out from under
    // a running JVM would be a use-after-free of the worst kind. There's
    // no "shut this VM down" path yet (this function is a proof-of-life
    // check, not the real server runtime), so for now the guest JVM and
    // its library just live for the rest of the process — acceptable for
    // a smoke test, not for the real feature built on top of this.
    std::mem::forget(lib);
    Ok(version)
}
