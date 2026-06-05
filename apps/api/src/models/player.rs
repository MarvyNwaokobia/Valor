use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq)]
#[sqlx(type_name = "text", rename_all = "PascalCase")]
pub enum Rank {
    Bronze,
    Silver,
    Gold,
    Platinum,
    Diamond,
}

impl Rank {
    pub fn g_reward(&self) -> u64 {
        match self {
            Rank::Bronze => 10,
            Rank::Silver => 20,
            Rank::Gold => 40,
            Rank::Platinum => 80,
            Rank::Diamond => 150,
        }
    }

    pub fn next(&self) -> Option<Rank> {
        match self {
            Rank::Bronze => Some(Rank::Silver),
            Rank::Silver => Some(Rank::Gold),
            Rank::Gold => Some(Rank::Platinum),
            Rank::Platinum => Some(Rank::Diamond),
            Rank::Diamond => None,
        }
    }

    pub fn prev(&self) -> Option<Rank> {
        match self {
            Rank::Bronze => None,
            Rank::Silver => Some(Rank::Bronze),
            Rank::Gold => Some(Rank::Silver),
            Rank::Platinum => Some(Rank::Gold),
            Rank::Diamond => Some(Rank::Platinum),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
pub enum DecayStatus {
    None,
    Warning,
    Active,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "PascalCase")]
pub enum PlayStyle {
    Wanderer,
    Fighter,
    Champion,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Player {
    pub wallet_address: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub character_class: Option<String>,
    #[sqlx(json)]
    pub character_customization: serde_json::Value,
    pub play_style: String,
    pub avatar: String,
    pub character_name: String,
    pub rank: String,
    pub xp: i32,
    pub attack_stat: i32,
    pub defense_stat: i32,
    pub speed_stat: i32,
    #[serde(with = "rust_decimal::serde::float")]
    pub g_earned_lifetime: Decimal,
    pub last_active: DateTime<Utc>,
    pub decay_status: String,
    pub decay_frozen_until: Option<DateTime<Utc>>,
    pub wins: i32,
    pub losses: i32,
    pub created_at: DateTime<Utc>,
}
