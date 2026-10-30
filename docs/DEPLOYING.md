# Deploying

The website is the `site/` folder: four static files plus `data/aggregates.json`. Anything that
serves files can host it. There's no server code, database or runtime to maintain.

- [The publishing workflow](#the-publishing-workflow)
- [GitHub Pages](#github-pages)
- [GitLab Pages](#gitlab-pages)
- [Azure Static Web Apps](#azure-static-web-apps)
- [Anywhere else](#anywhere-else)
- [Building from a secure source in CI (advanced)](#building-from-a-secure-source-in-ci-advanced)

---

## The publishing workflow

The default setup keeps microdata out of Git and out of CI entirely:

```
your secure machine / Fabric                      Git + CI                           the web
────────────────────────────                      ────────                           ───────
make aggregate   →  make test   →  git commit site/data/aggregates.json  →  tests  →  deploy site/
```

```bash
make aggregate && make test
git add site/data/aggregates.json config/survey.toml
git commit -m "Refresh aggregates"
git push
```

CI runs the public-file checks again and only deploys if they pass.

---

## GitHub Pages

1. Push the repo to GitHub.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`. [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) tests and publishes `site/`.
4. Your site is at `https://<account>.github.io/<repo>/`. The Actions tab shows progress.

> **Private repo?** GitHub Pages on private repos needs a paid plan, and the published site is still
> public unless you use GitHub Enterprise's access control. The *data* is aggregate-only either way.

**Status badge** (optional), for the top of the README:

```markdown
[![CI](https://github.com/<account>/<repo>/actions/workflows/ci.yml/badge.svg)](https://github.com/<account>/<repo>/actions/workflows/ci.yml)
```

---

## GitLab Pages

[`.gitlab-ci.yml`](../.gitlab-ci.yml) is included. Push to the default branch and the `pages` job publishes
`site/`. Find the URL under **Deploy → Pages**. For a self-managed GitLab, check with your admin that
Pages is enabled. If your runners pull images from Artifactory, change `image:` to your mirrored uv image.

---

## Azure Static Web Apps

1. In the Azure portal, create a **Static Web App** and connect it to your repo.
2. Build details: **App location** `site`, **Api location** blank, **Output location** blank.
3. Azure adds a workflow file to your repo and deploys on every push.

To restrict access (internal-only dashboards), use Static Web Apps' built-in Entra ID authentication
with a `staticwebapp.config.json` in `site/`.

---

## Anywhere else

Copy the contents of `site/` to the web root:

- **S3 + CloudFront, Netlify, Cloudflare Pages:** set the publish directory to `site`.
- **IIS / Apache / nginx:** copy the files. Make sure `.json` is served as `application/json`, and turn
  on gzip/brotli: the data file compresses from ~300 KB to ~60 KB.
- **SharePoint / Teams:** these usually block custom JavaScript. Host elsewhere and link to it.

The site must be served over HTTP(S). Opening `index.html` straight from disk won't load the data.

---

## Building from a secure source in CI (advanced)

If the refresh should run automatically, you can build in CI instead of committing the JSON. The CI
job then needs read access to the microdata, so this is a bigger security decision. Prefer a
**self-hosted runner inside your network** (or a Fabric pipeline) over a cloud runner with
credentials.

Sketch for GitHub Actions on a self-hosted runner:

```yaml
jobs:
  build:
    runs-on: [self-hosted, secure-data]
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v7
      - run: uv sync --locked
      - run: uv run python pipeline/build_aggregates.py   # config [source] path points at the secure share
      - run: uv run pytest                                # full checks, including against the microdata
      - uses: actions/upload-pages-artifact@v5
        with: { path: site }
  deploy:
    needs: build
    # ... same deploy steps as pages.yml
```

Rules of thumb:

- Never upload the microdata as a CI artifact or cache, and never `echo` it into logs.
- Keep credentials in CI secrets and scope them read-only to the one dataset.
- Only `site/` should leave the secure runner.
