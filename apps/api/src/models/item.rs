use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Item {
    pub id: Uuid,
    pub on_chain_id: Option<i16>,
    pub name: String,
    pub description: String,
    pub rarity: String,
    pub category: String,
    pub stat_boost: i32,
    #[serde(with = "rust_decimal::serde::float")]
    pub price_g: Decimal,
    pub image_url: String,
    pub layer_type: Option<String>,
    pub layer_asset_url: Option<String>,
    pub total_supply: Option<i32>,
    pub remaining_supply: Option<i32>,
    pub weapon_stats: Option<serde_json::Value>,
    /// When this item stops being purchasable. NULL = on sale indefinitely. Used for
    /// season-limited weapons; the marketplace shows a countdown only when it is set.
    pub sale_ends_at: Option<chrono::DateTime<chrono::Utc>>,
}
