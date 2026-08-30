//! Minimal Cloudflare R2 (S3-compatible) object client.
//!
//! Presign with `rusty-s3`, execute with `ureq`. Blocking. No AWS SDK.
//!
//! `head` / `put_json` / `get_json` / `Object::etag` are here for the
//! conditional-write (real CAS) path that lands after the MVP.
#![allow(dead_code)]

use std::io::Read;
use std::time::Duration;

use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use serde::{Deserialize, Serialize};

const SIGN_TTL: Duration = Duration::from_secs(900);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct R2Config {
    /// Cloudflare account id (the `<id>` in `<id>.r2.cloudflarestorage.com`).
    pub account_id: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl R2Config {
    fn bucket(&self) -> Result<Bucket, String> {
        let endpoint = format!("https://{}.r2.cloudflarestorage.com", self.account_id);
        Bucket::new(
            endpoint.parse().map_err(|e| format!("bad account id: {e}"))?,
            UrlStyle::Path,
            self.bucket.clone(),
            "auto".to_string(),
        )
        .map_err(|e| format!("bad bucket config: {e}"))
    }

    fn creds(&self) -> Credentials {
        Credentials::new(self.access_key_id.clone(), self.secret_access_key.clone())
    }
}

pub struct Object {
    pub bytes: Vec<u8>,
    pub etag: Option<String>,
}

pub struct R2 {
    bucket: Bucket,
    creds: Credentials,
}

impl R2 {
    pub fn new(cfg: &R2Config) -> Result<Self, String> {
        Ok(R2 {
            bucket: cfg.bucket()?,
            creds: cfg.creds(),
        })
    }

    /// A cheap round-trip to validate credentials + bucket access.
    pub fn check(&self) -> Result<(), String> {
        // list with max-keys=0 — needs only bucket read
        let action = self.bucket.list_objects_v2(Some(&self.creds));
        let url = action.sign(SIGN_TTL);
        match ureq::get(url.as_str()).call() {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(403, _)) => {
                Err("Access denied — the API token can't read this bucket.".into())
            }
            Err(ureq::Error::Status(404, _)) => {
                Err("Bucket not found — check the name and account id.".into())
            }
            Err(e) => Err(format!("Couldn't reach R2: {e}")),
        }
    }

    pub fn put(&self, key: &str, data: &[u8], content_type: &str) -> Result<(), String> {
        let mut action = self.bucket.put_object(Some(&self.creds), key);
        action
            .headers_mut()
            .insert("content-type", content_type.to_string());
        let url = action.sign(SIGN_TTL);
        ureq::put(url.as_str())
            .set("content-type", content_type)
            .send_bytes(data)
            .map_err(|e| format!("upload {key}: {e}"))?;
        Ok(())
    }

    pub fn put_json<T: Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        self.put(key, &bytes, "application/json")
    }

    pub fn get(&self, key: &str) -> Result<Option<Object>, String> {
        let action = self.bucket.get_object(Some(&self.creds), key);
        let url = action.sign(SIGN_TTL);
        match ureq::get(url.as_str()).call() {
            Ok(resp) => {
                let etag = resp.header("etag").map(clean_etag);
                let mut bytes = Vec::new();
                resp.into_reader()
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                Ok(Some(Object { bytes, etag }))
            }
            Err(ureq::Error::Status(404, _)) => Ok(None),
            Err(e) => Err(format!("download {key}: {e}")),
        }
    }

    pub fn get_json<T: for<'de> Deserialize<'de>>(&self, key: &str) -> Result<Option<T>, String> {
        match self.get(key)? {
            Some(obj) => serde_json::from_slice(&obj.bytes)
                .map(Some)
                .map_err(|e| format!("{key} is not valid JSON: {e}")),
            None => Ok(None),
        }
    }

    pub fn head(&self, key: &str) -> Result<Option<String>, String> {
        let action = self.bucket.head_object(Some(&self.creds), key);
        let url = action.sign(SIGN_TTL);
        match ureq::head(url.as_str()).call() {
            Ok(resp) => Ok(resp.header("etag").map(clean_etag)),
            Err(ureq::Error::Status(404, _)) => Ok(None),
            Err(e) => Err(format!("head {key}: {e}")),
        }
    }

    pub fn delete(&self, key: &str) -> Result<(), String> {
        let action = self.bucket.delete_object(Some(&self.creds), key);
        let url = action.sign(SIGN_TTL);
        match ureq::delete(url.as_str()).call() {
            Ok(_) | Err(ureq::Error::Status(404, _)) => Ok(()),
            Err(e) => Err(format!("delete {key}: {e}")),
        }
    }
}

fn clean_etag(s: &str) -> String {
    s.trim().trim_matches('"').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_builds_endpoint() {
        let cfg = R2Config {
            account_id: "abc123".into(),
            bucket: "craftpanel-sync".into(),
            access_key_id: "k".into(),
            secret_access_key: "s".into(),
        };
        assert!(cfg.bucket().is_ok());
    }

    #[test]
    fn etag_is_unquoted() {
        assert_eq!(clean_etag("\"deadbeef\""), "deadbeef");
    }
}
