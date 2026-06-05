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

async fn health() -> HttpResponse {
    HttpResponse::Ok().finish()
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg
        .route("/health", web::get().to(health))
        .route("/ws/battle", web::get().to(ws::battle_ws))
        .service(
            web::scope("/identity")
                .route("/verify/{wallet}", web::get().to(identity::verify_identity)),
        )
        .service(
            web::scope("/players")
                .route("", web::get().to(players::list_players))
                .route("", web::post().to(players::create_player))
                .route("/{wallet}", web::get().to(players::get_player))
                .route("/{wallet}/daily-claim", web::post().to(players::daily_claim))
                .route("/{wallet}/daily-claim-status", web::get().to(players::daily_claim_status))
                .route("/{wallet}/decay-check", web::post().to(players::decay_check))
                .route("/{wallet}/rank-up", web::post().to(players::rank_up_reward))
                .route("/{wallet}/inventory", web::get().to(players::get_inventory))
                .route("/{wallet}/inventory", web::post().to(players::add_inventory_item)),
        )
        .service(
            web::scope("/battles")
                .route("/bot", web::post().to(battles::fight_bot))
                .route("/challenge", web::post().to(battles::challenge_player)),
        )
        .service(
            web::scope("/missions")
                .route("/{id}/collect", web::post().to(missions::collect_mission)),
        )
        .service(
            web::scope("/items")
                .route("", web::get().to(items::list_items)),
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
            web::scope("/auth")
                .route("/token", web::post().to(auth::issue_token)),
        );
}
