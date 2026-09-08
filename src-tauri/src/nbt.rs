//! Generic NBT read/write — `level.dat`, `playerdata/<uuid>.dat`, and
//! similar. Not schema-aware (doesn't know Minecraft's specific tag
//! layout for any one file); just a faithful, generic tree, so the file
//! browser can show and edit one without shipping a hand-rolled binary
//! parser. Built on `fastnbt` rather than parsing the format by hand.

use std::fs;
use std::io::{Read, Write};
use std::path::Path;

use fastnbt::{ByteArray, IntArray, LongArray, Value};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};

/// Tauri's IPC boundary round-trips through JSON, and JS numbers can't
/// exactly hold every `i64` (world seeds, in particular, are `Long`s that
/// routinely land outside `Number.MAX_SAFE_INTEGER`) — serializing as a
/// plain JSON number would silently corrupt exactly the kind of value
/// this editor exists to let someone see and change correctly. Only
/// crosses this string boundary for the JSON side; the actual NBT
/// bytes on disk are still real binary `i64`s the whole time.
mod i64_str {
    use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(v: &i64, s: S) -> Result<S::Ok, S::Error> {
        v.to_string().serialize(s)
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        String::deserialize(d)?.parse().map_err(D::Error::custom)
    }
}

mod i64_vec_str {
    use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(v: &[i64], s: S) -> Result<S::Ok, S::Error> {
        v.iter().map(i64::to_string).collect::<Vec<_>>().serialize(s)
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<i64>, D::Error> {
        Vec::<String>::deserialize(d)?
            .into_iter()
            .map(|s| s.parse().map_err(D::Error::custom))
            .collect()
    }
}

/// A generic NBT tree, shaped for the frontend rather than fastnbt's own
/// `Value` (whose `Compound` is a `HashMap`, so unordered — fine for
/// fastnbt's own purposes, not great for a stable tree UI). Compound
/// entries are a plain `Vec` of pairs instead: NBT compounds are
/// unordered by spec (nothing reads them positionally), so sorting them
/// alphabetically on read is a deliberate, deterministic choice, not an
/// attempt to preserve "the" original order — there isn't one to preserve.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NbtNode {
    Byte { value: i8 },
    Short { value: i16 },
    Int { value: i32 },
    Long {
        #[serde(with = "i64_str")]
        value: i64,
    },
    Float { value: f32 },
    Double { value: f64 },
    String { value: String },
    ByteArray { value: Vec<i8> },
    IntArray { value: Vec<i32> },
    LongArray {
        #[serde(with = "i64_vec_str")]
        value: Vec<i64>,
    },
    List { value: Vec<NbtNode> },
    Compound { value: Vec<(String, NbtNode)> },
}

fn from_value(v: Value) -> NbtNode {
    match v {
        Value::Byte(x) => NbtNode::Byte { value: x },
        Value::Short(x) => NbtNode::Short { value: x },
        Value::Int(x) => NbtNode::Int { value: x },
        Value::Long(x) => NbtNode::Long { value: x },
        Value::Float(x) => NbtNode::Float { value: x },
        Value::Double(x) => NbtNode::Double { value: x },
        Value::String(x) => NbtNode::String { value: x },
        Value::ByteArray(x) => NbtNode::ByteArray { value: x.to_vec() },
        Value::IntArray(x) => NbtNode::IntArray { value: x.to_vec() },
        Value::LongArray(x) => NbtNode::LongArray { value: x.to_vec() },
        Value::List(items) => NbtNode::List { value: items.into_iter().map(from_value).collect() },
        Value::Compound(map) => {
            let mut entries: Vec<(String, NbtNode)> =
                map.into_iter().map(|(k, v)| (k, from_value(v))).collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            NbtNode::Compound { value: entries }
        }
    }
}

fn to_value(n: NbtNode) -> Value {
    match n {
        NbtNode::Byte { value } => Value::Byte(value),
        NbtNode::Short { value } => Value::Short(value),
        NbtNode::Int { value } => Value::Int(value),
        NbtNode::Long { value } => Value::Long(value),
        NbtNode::Float { value } => Value::Float(value),
        NbtNode::Double { value } => Value::Double(value),
        NbtNode::String { value } => Value::String(value),
        NbtNode::ByteArray { value } => Value::ByteArray(ByteArray::new(value)),
        NbtNode::IntArray { value } => Value::IntArray(IntArray::new(value)),
        NbtNode::LongArray { value } => Value::LongArray(LongArray::new(value)),
        NbtNode::List { value } => Value::List(value.into_iter().map(to_value).collect()),
        NbtNode::Compound { value } => {
            let map: std::collections::HashMap<String, Value> =
                value.into_iter().map(|(k, v)| (k, to_value(v))).collect();
            Value::Compound(map)
        }
    }
}

fn is_gzip(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

/// Reads and parses an NBT file, transparently gunzipping if it's
/// compressed (as almost every on-disk Minecraft NBT file is —
/// `level.dat`, `playerdata/*.dat`). Returns the tree plus whether it was
/// gzipped, so a write-back can compress it the same way it found it.
pub fn read(path: &Path) -> Result<(NbtNode, bool), String> {
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    let gzipped = is_gzip(&raw);
    let bytes = if gzipped {
        let mut out = Vec::new();
        GzDecoder::new(&raw[..])
            .read_to_end(&mut out)
            .map_err(|e| format!("not valid gzip: {e}"))?;
        out
    } else {
        raw
    };
    let value: Value = fastnbt::from_bytes(&bytes).map_err(|e| format!("not valid NBT: {e}"))?;
    Ok((from_value(value), gzipped))
}

/// Writes a tree back to disk, re-compressing if the original was
/// gzipped. Always leaves a `.bak` copy of whatever was there before —
/// this is the one file-editing path in the app that can't fall back on
/// the trash folder if a hand-edited tree turns out to make the file
/// unreadable, so the safety net is a plain sibling file instead.
pub fn write(path: &Path, root: NbtNode, gzip: bool) -> Result<(), String> {
    if let Ok(existing) = fs::read(path) {
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("dat");
        let bak = path.with_extension(format!("{ext}.bak"));
        let _ = fs::write(bak, existing);
    }

    let value = to_value(root);
    let bytes = fastnbt::to_bytes(&value).map_err(|e| e.to_string())?;

    if gzip {
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&bytes).map_err(|e| e.to_string())?;
        let compressed = enc.finish().map_err(|e| e.to_string())?;
        fs::write(path, compressed).map_err(|e| e.to_string())
    } else {
        fs::write(path, bytes).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Alphabetical by key on purpose — `from_value` always sorts compound
    // entries that way on read (see its doc comment: NBT compounds are
    // unordered by spec, so this is a deterministic choice, not "the"
    // original order), so a fixture used in a round-trip equality check
    // has to already be in that order or the comparison is really just
    // testing sort-vs-unsorted, not data fidelity.
    fn sample() -> NbtNode {
        NbtNode::Compound {
            value: vec![
                ("aByte".into(), NbtNode::Byte { value: -12 }),
                ("aDouble".into(), NbtNode::Double { value: 2.718281828 }),
                ("aFloat".into(), NbtNode::Float { value: 1.5 }),
                (
                    "aList".into(),
                    NbtNode::List {
                        value: vec![NbtNode::Int { value: 1 }, NbtNode::Int { value: 2 }],
                    },
                ),
                ("aLong".into(), NbtNode::Long { value: 123_456_789_012 }),
                ("aShort".into(), NbtNode::Short { value: 1234 }),
                ("aString".into(), NbtNode::String { value: "hello nbt".into() }),
                ("anInt".into(), NbtNode::Int { value: -99999 }),
                (
                    "nested".into(),
                    NbtNode::Compound {
                        value: vec![("deep".into(), NbtNode::String { value: "value".into() })],
                    },
                ),
                ("someBytes".into(), NbtNode::ByteArray { value: vec![1, -2, 3] }),
                ("someInts".into(), NbtNode::IntArray { value: vec![10, -20, 30] }),
                ("someLongs".into(), NbtNode::LongArray { value: vec![100, -200] }),
            ],
        }
    }

    fn roundtrip(gzip: bool) -> NbtNode {
        let value = to_value(sample());
        let bytes = fastnbt::to_bytes(&value).unwrap();
        let bytes = if gzip {
            let mut enc = GzEncoder::new(Vec::new(), Compression::default());
            enc.write_all(&bytes).unwrap();
            enc.finish().unwrap()
        } else {
            bytes
        };
        assert_eq!(is_gzip(&bytes), gzip);
        let decompressed = if gzip {
            let mut out = Vec::new();
            GzDecoder::new(&bytes[..]).read_to_end(&mut out).unwrap();
            out
        } else {
            bytes
        };
        let back: Value = fastnbt::from_bytes(&decompressed).unwrap();
        from_value(back)
    }

    #[test]
    fn every_primitive_and_array_type_roundtrips_uncompressed() {
        assert_eq!(roundtrip(false), sample());
    }

    #[test]
    fn roundtrips_through_gzip_too() {
        assert_eq!(roundtrip(true), sample());
    }

    #[test]
    fn read_write_cycle_on_a_real_file_preserves_the_data_and_backs_up_the_original() {
        let dir = std::env::temp_dir().join(format!("cp-nbt-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("level.dat");

        write(&path, sample(), true).unwrap();
        let (read_back, gzipped) = read(&path).unwrap();
        assert!(gzipped);
        assert_eq!(read_back, sample());

        // edit one field and write again — the previous file becomes level.dat.bak
        let edited = NbtNode::Compound {
            value: vec![("aByte".into(), NbtNode::Byte { value: 99 })],
        };
        write(&path, edited.clone(), true).unwrap();
        let bak_path = dir.join("level.dat.bak");
        assert!(bak_path.is_file(), ".bak should exist after a second write");
        let (bak_contents, _) = read(&bak_path).unwrap();
        assert_eq!(bak_contents, sample(), ".bak should hold the pre-edit data");

        let (current, _) = read(&path).unwrap();
        assert_eq!(current, edited);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_world_seed_sized_long_survives_the_json_boundary_exactly() {
        // A real, large i64 seed — well past Number.MAX_SAFE_INTEGER
        // (9,007,199,254,740,991). If this were a plain JSON number
        // instead of a string, serde_json would still round-trip it
        // correctly on the Rust side (it's not going through a JS engine
        // here), so this test specifically checks the *wire shape* is a
        // string, since that's what actually protects the value once it
        // crosses into JS via Tauri's IPC.
        let seed: i64 = -8_190_331_733_697_211_845;
        let node = NbtNode::Long { value: seed };
        let json = serde_json::to_value(&node).unwrap();
        assert_eq!(json["value"], serde_json::Value::String(seed.to_string()));

        let back: NbtNode = serde_json::from_value(json).unwrap();
        assert_eq!(back, NbtNode::Long { value: seed });

        let arr = NbtNode::LongArray { value: vec![seed, 0, -seed] };
        let json = serde_json::to_value(&arr).unwrap();
        assert!(json["value"].as_array().unwrap().iter().all(|v| v.is_string()));
        let back: NbtNode = serde_json::from_value(json).unwrap();
        assert_eq!(back, arr);
    }

    #[test]
    fn a_non_gzip_non_nbt_file_reports_a_clear_error_not_a_panic() {
        let dir = std::env::temp_dir().join(format!("cp-nbt-bad-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("not-nbt.dat");
        fs::write(&path, b"this is plainly not nbt data at all").unwrap();

        assert!(read(&path).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
