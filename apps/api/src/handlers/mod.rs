use actix_web::{web, HttpResponse};

pub mod players;
pub mod identity;
pub mod battles;
pub mod missions;
pub mod items;
pub mod decay;
pub mod rewards;
pub mod auth;
pub mod ws;
pub mod endless;
pub mod survival;
pub mod gauntlet;
pub mod seasons;
pub mod ledger;
pub mod admin;

async fn health() -> HttpResponse {
    HttpResponse::Ok().finish()
}

// Friendly root — this is a backend API, not a website, so hitting `/` in a browser
// used to 404 and look "down". Return a small alive message + where the real routes are.
async fn root() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "service": "valor-api",
        "status": "ok",
        "message": "Valor API — OK. This is the backend for playvalor.app; there is no web page here.",
        "health": "/health",
    }))
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg
        .route("/", web::get().to(root))
        .route("/health", web::get().to(health))
        .route("/relay-address", web::get().to(ledger::get_relay_address))
        .route("/ws/battle", web::get().to(ws::battle_ws))
        .service(
            web::scope("/identity")
                .route("/verify/{wallet}", web::get().to(identity::verify_identity)),
        )
        .service(
            web::scope("/players")
                .route("", web::get().to(players::list_players))
                .route("", web::post().to(players::create_player))
                .route("/search", web::get().to(players::search_players))
                .route("/{wallet}", web::get().to(players::get_player))
                .route("/{wallet}/daily-claim", web::post().to(players::daily_claim))
                .route("/{wallet}/daily-claim-status", web::get().to(players::daily_claim_status))
                .route("/{wallet}/decay-check", web::post().to(players::decay_check))
                .route("/{wallet}", web::patch().to(players::update_player))
                .route("/{wallet}/inventory", web::get().to(players::get_inventory))
                .route("/{wallet}/inventory", web::post().to(players::add_inventory_item))
                .route("/{wallet}/username-available/{username}", web::get().to(players::check_username))
                .route("/{wallet}/achievements", web::get().to(players::get_achievements))
                .route("/{wallet}/achievements/check", web::post().to(players::check_achievements))
                .route("/{wallet}/inventory/{item_id}", web::patch().to(players::toggle_equip))
                .route("/{wallet}/battles", web::get().to(players::get_battles))
                .route("/{wallet}/freeze-decay", web::post().to(players::freeze_decay))
                .route("/{wallet}/ledger-summary", web::get().to(ledger::get_ledger_summary))
                .route("/{wallet}/transfer", web::post().to(ledger::transfer_out)),
        )
        .service(
            web::scope("/battles")
                .route("/bot/start", web::post().to(battles::start_bot_fight))
                .route("/bot/round", web::post().to(battles::bot_fight_round))
                .route("/fight/start", web::post().to(battles::start_live_fight))
                .route("/fight/complete", web::post().to(battles::complete_live_fight))
                .route("/pvp/complete", web::post().to(battles::complete_pvp_match))
                .route("/bounties/reconcile", web::post().to(battles::reconcile_first_clear_bounties))
                .route("/challenge", web::post().to(battles::challenge_player)),
        )
        .service(
            web::scope("/missions")
                .route("/active", web::get().to(missions::get_active_mission))
                .route("/deploy", web::post().to(missions::deploy_mission))
                .route("/{id}/collect", web::post().to(missions::collect_mission)),
        )
        .service(
            web::scope("/items")
                .route("", web::get().to(items::list_items))
                .route("/{id}/purchase", web::post().to(items::purchase_item))
                .route("/{id}/purchase-relay", web::post().to(items::purchase_item_relay)),
        )
        .service(
            web::scope("/decay")
                .route("/run", web::post().to(decay::run_decay_sweep)),
        )
        .service(
            web::scope("/rewards")
                .route("/sign-claim", web::post().to(rewards::sign_engagement_claim)),
        )
        .service(
            web::scope("/endless")
                .route("/start", web::post().to(endless::start_endless))
                .route("/wave", web::post().to(endless::endless_wave))
                .route("/end", web::post().to(endless::end_endless))
                .route("/score", web::post().to(endless::submit_score))
                .route("/leaderboard", web::get().to(endless::get_leaderboard)),
        )
        .service(
            web::scope("/survival")
                .route("/arm", web::post().to(survival::arm_session))
                .route("/rearm", web::post().to(survival::rearm)),
        )
        .service(
            web::scope("/gauntlet")
                .route("/start", web::post().to(gauntlet::start_run))
                .route("/submit", web::post().to(gauntlet::submit_run))
                .route("/leaderboard", web::get().to(gauntlet::leaderboard)),
        )
        .service(
            web::scope("/auth")
                .route("/token", web::post().to(auth::issue_token)),
        )
        .service(
            web::scope("/admin")
                .route("/login", web::post().to(admin::login))
                .route("/stats", web::get().to(admin::get_stats))
                .route("/onchain", web::get().to(admin::list_onchain))
                .route("/seasons", web::get().to(admin::list_seasons))
                .route("/seasons", web::post().to(admin::create_season))
                .route("/seasons/{id}/end", web::post().to(admin::end_season))
                .route("/seasons/{id}/fund", web::post().to(seasons::fund))
                .route("/seasons/{id}/payout", web::post().to(seasons::payout)),
        )
        .service(
            web::scope("/seasons")
                .route("/current", web::get().to(seasons::current)),
        );
}
