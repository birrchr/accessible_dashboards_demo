# data/raw — private microdata (git-ignored)

Put your respondent-level file here, or point `[source] path` in `config/survey.toml` somewhere else.
Everything in this folder except this README is excluded by `.gitignore`, so it can't be committed by accident.

`make demo-data` writes a synthetic `microdata.parquet` here for trying things out.
