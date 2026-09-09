//! Captures the process's `JavaVM` ourselves, at native-library load time,
//! instead of relying on `ndk-context` — this Tauri/wry build never calls
//! `ndk_context::initialize_android_context()`, confirmed by a real
//! on-device crash (`android context was not initialized`, from
//! `ndk-context-0.1.1/src/lib.rs:72`) before this module existed.
//!
//! `JNI_OnLoad` is a standard JNI entry point: the Android runtime calls it
//! automatically, exactly once, the moment it loads `libmobile_lib.so` (via
//! `System.loadLibrary`, which Tauri's own generated `MainActivity`/
//! `WryActivity` already does to load this library at all) — before any of
//! our own Rust code runs. That guarantees the VM pointer below is set
//! before any Tauri command could possibly ask for it.

use std::sync::OnceLock;

use jni::sys::{jint, JNI_VERSION_1_6};
use jni::JavaVM;

static VM_PTR: OnceLock<usize> = OnceLock::new();

/// # Safety
/// Called by the Android/JVM runtime itself when this library loads, with
/// a valid `JavaVM*` — never called by our own code.
#[no_mangle]
pub extern "system" fn JNI_OnLoad(vm: JavaVM, _reserved: *mut std::ffi::c_void) -> jint {
    let raw = vm.get_java_vm_pointer() as usize;
    let _ = VM_PTR.set(raw);
    JNI_VERSION_1_6
}

/// The captured `JavaVM`, or an error if `JNI_OnLoad` somehow hasn't run
/// yet (it always has, by the time any Tauri command can execute).
pub fn get() -> Result<JavaVM, String> {
    let raw = *VM_PTR.get().ok_or("JNI_OnLoad has not run yet — no JavaVM captured")?;
    // SAFETY: raw was produced by JavaVM::get_java_vm_pointer() on a real,
    // still-live JavaVM (the process's one and only JVM never goes away).
    unsafe { JavaVM::from_raw(raw as *mut jni::sys::JavaVM) }.map_err(|e| e.to_string())
}
