use actix_cors::Cors;
use actix_web::{middleware::Logger, web, App, HttpServer};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::str::FromStr;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod handlers;
mod models;
mod services;
mod utils;

pub struct AppState {
    pub db:             sqlx::PgPool,
    pub rewards:        Option<services::rewards::RewardService>,
    pub battle_limiter: services::rate_limiter::RateLimiter,
    pub rank_limiter:   services::rate_limiter::RateLimiter,
    pub game_server:    services::game_server::GameServerHandle,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let connect_opts = PgConnectOptions::from_str(&database_url)
        .expect("Invalid DATABASE_URL")
        .statement_cache_capacity(0); // required for PgBouncer transaction-mode pooler
    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect_with(connect_opts)
        .await?;

    let rewards = services::rewards::RewardService::from_env()
        .map_err(|e| tracing::warn!("Reward service disabled: {}", e))
        .ok();

    // Start event listener as a background task
    if let Some(listener) = services::event_listener::EventListener::from_env(db.clone()) {
        listener.spawn();
    } else {
        tracing::info!("Event listener disabled (MARKETPLACE_CONTRACT not set)");
    }

    // Rate limiters — shared across all workers via AppState (DashMap is Send + Sync)
    // battle_limiter: 10 requests / 60s per IP
    // rank_limiter:   2 requests / 60s per IP
    let battle_limiter = services::rate_limiter::RateLimiter::new(10, 60);
    let rank_limiter   = services::rate_limiter::RateLimiter::new(2, 60);
    let game_server    = services::game_server::GameServerHandle::spawn(db.clone());

    // FRONTEND_ORIGIN: always allow localhost in dev; lock to production domain when set
    let frontend_origin = std::env::var("FRONTEND_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:5173".into());

    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    tracing::info!("Starting Valor API on {}", bind_addr);
    tracing::info!("CORS allowed origin: {}", frontend_origin);

    HttpServer::new(move || {
        let allowed = frontend_origin.clone();
        let cors = Cors::default()
            .allowed_origin_fn(move |origin, _req_head| {
                let s = origin.to_str().unwrap_or("");
                // Always allow local dev; lock everything else to the configured origin
                s == allowed || s.starts_with("http://localhost:")
            })
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .app_data(web::Data::new(AppState {
                db:             db.clone(),
                rewards:        rewards.clone(),
                battle_limiter: services::rate_limiter::RateLimiter::new(10, 60),
                rank_limiter:   services::rate_limiter::RateLimiter::new(2, 60),
                game_server:    game_server.clone(),
            }))
            .wrap(Logger::default())
            .wrap(cors)
            .configure(handlers::configure_routes)
    })
    .bind(&bind_addr)?
    .run()
    .await?;

    Ok(())
}
