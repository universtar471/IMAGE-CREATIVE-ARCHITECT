//! Backend mirror of the domain enums (canonical definitions live in `packages/domain`).
//! Stored in SQLite as their snake_case string values.

use serde::{Deserialize, Serialize};

macro_rules! string_enum {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $text)] $variant),+
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self { $($name::$variant => $text),+ }
            }

            pub fn parse(s: &str) -> Option<Self> {
                match s { $($text => Some($name::$variant),)+ _ => None }
            }
        }

        impl rusqlite::types::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }

        impl rusqlite::types::FromSql for $name {
            fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
                let s = value.as_str()?;
                $name::parse(s).ok_or_else(|| rusqlite::types::FromSqlError::Other(
                    format!("unknown {} value '{s}'", stringify!($name)).into(),
                ))
            }
        }
    };
}

string_enum!(ProjectType {
    Interior => "interior",
    Townhouse => "townhouse",
    SingleStoreyHouse => "single_storey_house",
    Villa => "villa",
    UrbanVilla => "urban_villa",
    PrefabModular => "prefab_modular",
    Cafe => "cafe",
    Restaurant => "restaurant",
    Hotel => "hotel",
    Office => "office",
    Commercial => "commercial",
    Resort => "resort",
    Custom => "custom",
});

string_enum!(ProjectStatus {
    Draft => "draft",
    DnaReady => "dna_ready",
    Concepting => "concepting",
    MasterPending => "master_pending",
    MasterApproved => "master_approved",
    AnchorGeneration => "anchor_generation",
    DesignLocked => "design_locked",
    Production => "production",
    Qc => "qc",
    Final => "final",
    Archived => "archived",
});

string_enum!(AssetRole {
    MasterArchitecture => "master_architecture",
    ArchitectureReference => "architecture_reference",
    MaterialReference => "material_reference",
    ContextReference => "context_reference",
    LandscapeReference => "landscape_reference",
    LightingReference => "lighting_reference",
    MoodReference => "mood_reference",
    CameraReference => "camera_reference",
    RegularImage => "regular_image",
});

string_enum!(AssetSource {
    External => "external",
    AiGenerated => "ai_generated",
    Sketchup => "sketchup",
    Vray => "vray",
    Corona => "corona",
    D5 => "d5",
    Enscape => "enscape",
    Photo => "photo",
    Reference => "reference",
    Other => "other",
});

string_enum!(GenerationPurpose {
    Hero => "hero",
    Variation => "variation",
    Anchor => "anchor",
    Production => "production",
    Enhance => "enhance",
});

impl GenerationPurpose {
    /// Prefix of generated asset/version names, e.g. "Hero 1 — <model label>".
    pub fn label(self) -> &'static str {
        match self {
            Self::Hero => "Hero",
            Self::Variation => "Variation",
            Self::Anchor => "Anchor",
            Self::Production => "Production",
            Self::Enhance => "Enhance",
        }
    }
}

string_enum!(GenerationStatus {
    Queued => "queued",
    Running => "running",
    Completed => "completed",
    Failed => "failed",
    Interrupted => "interrupted",
    Cancelled => "cancelled",
});

string_enum!(JobStatus {
    Queued => "queued",
    Running => "running",
    Retrying => "retrying",
    Completed => "completed",
    Failed => "failed",
    Cancelled => "cancelled",
    Interrupted => "interrupted",
});

impl JobStatus {
    /// Terminal states never change again (a retry creates a new job).
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled | Self::Interrupted)
    }

    /// The generation status that mirrors this job status. A `retrying` job's generation
    /// is back to `queued`: it waits for its next attempt.
    pub fn generation_status(self) -> GenerationStatus {
        match self {
            Self::Queued | Self::Retrying => GenerationStatus::Queued,
            Self::Running => GenerationStatus::Running,
            Self::Completed => GenerationStatus::Completed,
            Self::Failed => GenerationStatus::Failed,
            Self::Cancelled => GenerationStatus::Cancelled,
            Self::Interrupted => GenerationStatus::Interrupted,
        }
    }
}
