//! The "keep everything recent, then thin older ones to one per day"
//! pruning decision — used by `snapshots.rs` (always) and `backups.rs`
//! (Premium's tiered mode, as an alternative to the plain "keep newest
//! N"). Pulled out to one place instead of two copies of the same
//! day-bucketing math with different struct types walking through it.
//!
//! Pure and clock-free (`now` is a parameter, not `SystemTime::now()`
//! inside) so it's testable with fixed timestamps instead of real wall
//! time — the day-boundary flakiness a real-clock version of this exact
//! algorithm already hit once (see snapshots.rs's own prune test) doesn't
//! come up if the test picks `now` itself.

use std::collections::{HashMap, HashSet};

/// Given `(id, created_at)` pairs, returns the ids worth keeping under a
/// "keep everything from the last `recent_hours`, then thin older ones to
/// one per day for `daily_days`" policy. Anything neither recent nor
/// within the daily window at all is left out entirely — the caller
/// deletes whatever isn't in the returned set.
pub fn tiered_keep_ids<'a>(
    now: i64,
    items: impl Iterator<Item = (&'a str, i64)>,
    recent_hours: u32,
    daily_days: u32,
) -> HashSet<String> {
    let recent_cutoff = now - recent_hours as i64 * 3600;
    let now_day = now.div_euclid(86400);

    let mut keep_ids: HashSet<String> = HashSet::new();
    let mut best_per_day: HashMap<i64, (&str, i64)> = HashMap::new();

    for (id, created_at) in items {
        if created_at >= recent_cutoff {
            keep_ids.insert(id.to_string());
            continue;
        }
        let day = created_at.div_euclid(86400);
        let age_days = now_day - day;
        if age_days > daily_days as i64 {
            continue; // past the retention window entirely
        }
        let better = best_per_day.get(&day).is_none_or(|&(_, cur)| created_at > cur);
        if better {
            best_per_day.insert(day, (id, created_at));
        }
    }
    keep_ids.extend(best_per_day.values().map(|&(id, _)| id.to_string()));
    keep_ids
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400;

    #[test]
    fn keeps_everything_inside_the_recent_window() {
        let now = 1_000_000i64;
        let items = [("a", now - 60), ("b", now - 3600), ("c", now)];
        let kept = tiered_keep_ids(now, items.into_iter(), 24, 30);
        assert_eq!(kept.len(), 3);
    }

    #[test]
    fn thins_older_days_to_the_single_newest_entry() {
        let now = 10 * DAY;
        let day5_start = now - 5 * DAY;
        let items = [
            ("older", day5_start + 3600),  // 5 days ago, earlier that day
            ("newer", day5_start + 7200),  // 5 days ago, later that day — should win
        ];
        let kept = tiered_keep_ids(now, items.into_iter(), 24, 30);
        assert_eq!(kept, HashSet::from(["newer".to_string()]));
    }

    #[test]
    fn drops_anything_past_the_daily_window_entirely() {
        let now = 100 * DAY;
        let items = [("ancient", now - 60 * DAY)];
        let kept = tiered_keep_ids(now, items.into_iter(), 24, 30);
        assert!(kept.is_empty());
    }
}
