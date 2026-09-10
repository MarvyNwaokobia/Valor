//! Runs the decay / reconcile / consistency / daily-notify sweeps from inside the
//! API process itself, on fixed intervals, instead of depending on GitHub Actions'
//! free-tier `schedule:` trigger to fire them — that scheduler is known to drift
//! (and can silently skip runs) under load, which matters most for reconcile
//! (real, already-promised G$ waiting to be retried) and consistency (the only
//! thing watching for a frozen player row or a stuck payout).
//!
//! `.github/workflows/decay-cron.yml` and `daily-notify-cron.yml`, and the HTTP
//! endpoints they hit, are left exactly as they are — every sweep below is
//! independently idempotent (see each handler's own doc comment), so a redundant
//! external trigger is free insurance, not a risk.
//!
//! Four separate tasks, not one task multiplexing four timers: reconcile has a
//! documented history of hanging for hours on an RPC stall (see main.rs), and a
//! shared loop would let a wedged reconcile tick starve the other three.

use crate::AppState;

/// Spawns the four sweeps as independent background tasks. Unconditional — this is
/// internal application logic, not an external integration, so there's no env var
/// to gate it on.
pub fn spawn(state: AppState) {
    spawn_interval("decay", state.clone(), std::time::Duration::from_secs(3 * 60 * 60), |state| {
        Box::pin(async move {
            let result = crate::handlers::decay::run_decay_sweep_inner(&state).await;
            tracing::debug!("scheduled decay sweep: {}", result);
        })
    });

    spawn_interval("reconcile", state.clone(), std::time::Duration::from_secs(15 * 60), |state| {
        Box::pin(async move {
            let result = crate::handlers::battles::run_reconcile_inner(&state).await;
            tracing::debug!("scheduled reconcile sweep: {}", result);
        })
    });

    spawn_interval("consistency", state.clone(), std::time::Duration::from_secs(15 * 60), |state| {
        Box::pin(async move {
            let result = crate::handlers::consistency::run_consistency_check_inner(&state).await;
            tracing::debug!("scheduled consistency check: {}", result);
        })
    });

    spawn_interval("daily-notify", state, std::time::Duration::from_secs(24 * 60 * 60), |state| {
        Box::pin(async move {
            let result = crate::handlers::push::run_daily_sweep_inner(&state).await;
            tracing::debug!("scheduled daily notify sweep: {}", result);
        })
    });
}

/// One named sweep, ticking on `period`. `MissedTickBehavior::Delay` on purpose —
/// if a tick runs long (reconcile's own 75s budget, an RPC hiccup), the next tick
/// is `period` after that run finishes rather than bursting to catch up.
fn spawn_interval<F>(name: &'static str, state: AppState, period: std::time::Duration, job: F)
where
    F: Fn(AppState) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> + Send + 'static,
{
    tokio::spawn(async move {
        tracing::info!("scheduler: {} started, every {:?}", name, period);
        let mut interval = tokio::time::interval(period);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // First tick fires immediately — skip it so a fresh deploy doesn't
        // immediately re-run everything the moment it boots.
        interval.tick().await;

        loop {
            interval.tick().await;
            job(state.clone()).await;
        }
    });
}
