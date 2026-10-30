"""
generate_demo_data.py
=====================
Generates synthetic microdata for the CanHealth 2024 Fictitious Health Survey.

This script simulates a realistic national health survey with ~5,000 respondents
across demographic groups and health-related variables. The output is a single
Parquet file written to data/raw/microdata.parquet.

Why Parquet?  It is columnar, compressed, and DuckDB reads it natively —
no need to load the full dataset into RAM before querying.

Run:
    uv run --group demo python pipeline/generate_demo_data.py   (or: make demo-data)
"""

import numpy as np
import pandas as pd
from faker import Faker
from pathlib import Path
import json

# ---------------------------------------------------------------------------
# Reproducibility
# ---------------------------------------------------------------------------
RNG = np.random.default_rng(seed=42)
fake = Faker("en_CA")
fake.seed_instance(42)

# ---------------------------------------------------------------------------
# Survey configuration
# ---------------------------------------------------------------------------
N = 5_000  # number of respondents

PROVINCES = {
    "Ontario": 0.385,
    "Quebec": 0.228,
    "British Columbia": 0.133,
    "Alberta": 0.115,
    "Manitoba": 0.036,
    "Saskatchewan": 0.031,
    "Nova Scotia": 0.026,
    "New Brunswick": 0.021,
    "Newfoundland": 0.014,
    "PEI": 0.004,
    "Territories": 0.007,
}

AGE_GROUPS = ["18–24", "25–34", "35–44", "45–54", "55–64", "65–74", "75+"]
AGE_WEIGHTS = [0.11, 0.16, 0.17, 0.16, 0.15, 0.14, 0.11]

GENDER = ["Man", "Woman", "Non-binary / Other", "Prefer not to say"]
GENDER_WEIGHTS = [0.48, 0.49, 0.02, 0.01]

INCOME_BRACKETS = ["Under $30K", "$30K–$59K", "$60K–$99K", "$100K–$149K", "$150K+"]
INCOME_WEIGHTS = [0.18, 0.26, 0.28, 0.17, 0.11]

EDUCATION = [
    "Less than high school",
    "High school diploma",
    "College / trades",
    "Undergraduate degree",
    "Graduate degree",
]
EDUCATION_WEIGHTS = [0.07, 0.23, 0.31, 0.26, 0.13]

SELF_RATED_HEALTH = ["Excellent", "Very good", "Good", "Fair", "Poor"]

CHRONIC_CONDITIONS = [
    "hypertension",
    "diabetes",
    "asthma",
    "depression",
    "anxiety",
    "arthritis",
    "heart_disease",
    "cancer_history",
]

PHYSICAL_ACTIVITY = [
    "Sedentary (< 30 min/week)",
    "Low (30–149 min/week)",
    "Moderate (150–299 min/week)",
    "High (300+ min/week)",
]

SMOKING_STATUS = ["Never", "Former", "Current – occasional", "Current – daily"]
SMOKING_WEIGHTS = [0.52, 0.24, 0.10, 0.14]

ALCOHOL_FREQ = [
    "Never",
    "Less than once/month",
    "1–3 times/month",
    "1–2 times/week",
    "3+ times/week",
]


# ---------------------------------------------------------------------------
# Helper samplers
# ---------------------------------------------------------------------------


def weighted_choice(options: list, weights: list, size: int) -> np.ndarray:
    weights_arr = np.array(weights, dtype=float)
    weights_arr /= weights_arr.sum()
    return RNG.choice(options, size=size, p=weights_arr)


def age_group_to_midpoint(ag: str) -> float:
    mapping = {
        "18–24": 21,
        "25–34": 29,
        "35–44": 39,
        "45–54": 49,
        "55–64": 59,
        "65–74": 69,
        "75+": 78,
    }
    return mapping[ag]


# ---------------------------------------------------------------------------
# Generate core demographics
# ---------------------------------------------------------------------------


def generate_demographics(n: int) -> pd.DataFrame:
    provinces = weighted_choice(list(PROVINCES.keys()), list(PROVINCES.values()), n)
    age_groups = weighted_choice(AGE_GROUPS, AGE_WEIGHTS, n)
    genders = weighted_choice(GENDER, GENDER_WEIGHTS, n)
    incomes = weighted_choice(INCOME_BRACKETS, INCOME_WEIGHTS, n)
    educations = weighted_choice(EDUCATION, EDUCATION_WEIGHTS, n)

    # Survey weights (post-stratification simulation)
    # Real surveys weight responses; we approximate with mild noise
    base_weight = n / n  # all start at 1.0
    weights = RNG.lognormal(mean=0.0, sigma=0.25, size=n)
    weights = weights / weights.mean()  # normalise so mean ≈ 1.0

    return pd.DataFrame({
        "respondent_id": [f"R{i:05d}" for i in range(1, n + 1)],
        "province": provinces,
        "age_group": age_groups,
        "age_midpoint": [age_group_to_midpoint(ag) for ag in age_groups],
        "gender": genders,
        "income_bracket": incomes,
        "education": educations,
        "survey_weight": weights.round(4),
    })


# ---------------------------------------------------------------------------
# Generate health variables (correlated with demographics)
# ---------------------------------------------------------------------------


def generate_health_vars(df: pd.DataFrame) -> pd.DataFrame:
    n = len(df)
    age_mid = df["age_midpoint"].values

    # Self-rated health: older and lower income → worse health
    # Build a latent score and map to categories
    income_score = (
        df["income_bracket"]
        .map({
            "Under $30K": -0.8,
            "$30K–$59K": -0.3,
            "$60K–$99K": 0.0,
            "$100K–$149K": 0.3,
            "$150K+": 0.5,
        })
        .values
    )
    latent = 2.5 - 0.025 * (age_mid - 40) + income_score + RNG.normal(0, 0.7, size=n)
    # Map latent to 5-point scale
    bins = [-np.inf, 0.5, 1.2, 1.9, 2.6, np.inf]
    labels = ["Poor", "Fair", "Good", "Very good", "Excellent"]
    srh = pd.cut(latent, bins=bins, labels=labels)

    # Chronic conditions: age-dependent Bernoulli draws
    age_factor = (age_mid - 18) / 60  # 0 at 18, 1 at 78

    def chronic_prob(base: float, age_mult: float = 0.6) -> np.ndarray:
        return np.clip(
            base + age_mult * age_factor + RNG.normal(0, 0.05, n), 0.01, 0.95
        )

    chronic = {
        "hypertension": RNG.binomial(1, chronic_prob(0.05, 0.55), n),
        "diabetes": RNG.binomial(1, chronic_prob(0.03, 0.30), n),
        "asthma": RNG.binomial(1, chronic_prob(0.09, 0.05), n),
        "depression": RNG.binomial(1, chronic_prob(0.12, -0.05), n),
        "anxiety": RNG.binomial(1, chronic_prob(0.15, -0.08), n),
        "arthritis": RNG.binomial(1, chronic_prob(0.02, 0.60), n),
        "heart_disease": RNG.binomial(1, chronic_prob(0.01, 0.40), n),
        "cancer_history": RNG.binomial(1, chronic_prob(0.02, 0.25), n),
    }
    chronic_df = pd.DataFrame(chronic)
    chronic_df["any_chronic"] = (chronic_df.sum(axis=1) > 0).astype(int)
    chronic_df["chronic_count"] = chronic_df[list(CHRONIC_CONDITIONS)].sum(axis=1)

    # Physical activity: younger and higher income → more active
    pa_latent = -0.015 * (age_mid - 40) + income_score * 0.4 + RNG.normal(0, 0.8, n)
    pa_bins = [-np.inf, -0.5, 0.2, 1.0, np.inf]
    physical_activity = pd.cut(pa_latent, bins=pa_bins, labels=PHYSICAL_ACTIVITY)
    physical_activity = pd.Series(
        pd.cut(pa_latent, bins=pa_bins, labels=PHYSICAL_ACTIVITY)
    )

    # Smoking
    smoking = weighted_choice(SMOKING_STATUS, SMOKING_WEIGHTS, n)

    # Alcohol
    alcohol = weighted_choice(ALCOHOL_FREQ, [0.15, 0.18, 0.22, 0.28, 0.17], n)

    # BMI (continuous) – correlated with activity and income
    activity_bmi_offset = (
        physical_activity
        .map({
            PHYSICAL_ACTIVITY[0]: 3.5,
            PHYSICAL_ACTIVITY[1]: 1.5,
            PHYSICAL_ACTIVITY[2]: 0.0,
            PHYSICAL_ACTIVITY[3]: -1.5,
        })
        .fillna(0)
        .to_numpy()
    )

    bmi = np.clip(
        27.5
        + activity_bmi_offset
        - income_score * 1.2
        + 0.04 * (age_mid - 40)
        + RNG.normal(0, 4.5, n),
        14,
        55,
    ).round(1)

    # Mental health score (PHQ-4 proxy, 0–12, lower is better)
    mh_score = (
        np
        .clip(
            4.0
            + chronic_df["depression"].values * 3.5
            + chronic_df["anxiety"].values * 3.0
            - income_score * 0.8
            + RNG.normal(0, 1.5, n),
            0,
            12,
        )
        .round(0)
        .astype(int)
    )

    # Healthcare access questions
    has_family_doctor = RNG.binomial(
        1, np.clip(0.78 + income_score * 0.06, 0.3, 0.97), n
    )
    unmet_care_need = RNG.binomial(
        1, np.clip(0.18 - income_score * 0.05, 0.02, 0.55), n
    )
    er_visits_12mo = RNG.poisson(lam=np.where(has_family_doctor == 0, 1.2, 0.4), size=n)

    result = pd.DataFrame({
        "self_rated_health": srh.astype(str),
        "physical_activity": physical_activity.astype(str),
        "smoking_status": smoking,
        "alcohol_frequency": alcohol,
        "bmi": bmi,
        "mental_health_score": mh_score,
        "has_family_doctor": has_family_doctor,
        "unmet_care_need": unmet_care_need,
        "er_visits_12mo": er_visits_12mo,
    })

    return pd.concat([result, chronic_df], axis=1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    out_dir = Path("data/raw")
    out_dir.mkdir(parents=True, exist_ok=True)

    print("🔧 Generating demographics …")
    demo = generate_demographics(N)

    print("🔧 Generating health variables …")
    health = generate_health_vars(demo)

    microdata = pd.concat([demo, health], axis=1)

    out_path = out_dir / "microdata.parquet"
    microdata.to_parquet(out_path, index=False, engine="pyarrow")
    print(f"✅ Wrote {len(microdata):,} rows → {out_path}")

    # Also write a tiny codebook JSON for the portal's metadata page
    codebook = {
        "survey_name": "CanHealth 2024 (Fictitious)",
        "n_respondents": N,
        "variables": {
            "province": "Province of residence",
            "age_group": "Age group (7 bands, 18+)",
            "gender": "Gender identity",
            "income_bracket": "Household annual income before tax",
            "education": "Highest educational attainment",
            "survey_weight": "Post-stratification survey weight (mean ≈ 1.0)",
            "self_rated_health": "Self-rated general health (5-point scale)",
            "physical_activity": "Weekly physical activity level",
            "smoking_status": "Cigarette smoking status",
            "alcohol_frequency": "Frequency of alcohol consumption",
            "bmi": "Body Mass Index (continuous, kg/m²)",
            "mental_health_score": "PHQ-4 proxy score (0–12, higher = worse)",
            "has_family_doctor": "Has a regular family doctor (0/1)",
            "unmet_care_need": "Reported an unmet healthcare need in past 12 months (0/1)",
            "er_visits_12mo": "Emergency room visits in past 12 months (count)",
            **{
                c: f"Has {c.replace('_', ' ')} diagnosis (0/1)"
                for c in CHRONIC_CONDITIONS
            },
            "any_chronic": "Has at least one chronic condition (0/1)",
            "chronic_count": "Number of chronic conditions (count)",
        },
    }
    codebook_path = out_dir / "codebook.json"
    codebook_path.write_text(json.dumps(codebook, indent=2))
    print(f"✅ Wrote codebook → {codebook_path}")


if __name__ == "__main__":
    main()
