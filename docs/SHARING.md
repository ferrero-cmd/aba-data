# Sharing ABA Data

ABA Data is a static website, so it can be hosted for free on **GitHub Pages**. Anyone with the link can
install it; each person's data stays on their own phone (nothing is uploaded, so one public URL is safe for
everyone). The repository contains only code, never client data.

## Publish (one time)

```bash
cd "Data Taker"
git init && git add . && git commit -m "ABA Data"
gh repo create aba-data --public --source . --push
gh api -X POST repos/{owner}/aba-data/pages -f "source[branch]=main" -f "source[path]=/"
```

The app is then at `https://<your-github-username>.github.io/aba-data/` (takes a minute the first time).
GitHub Pages on a free account needs the repo to be public — fine, since it holds no data.

**Pick the final address before real use.** Each phone's data belongs to that exact web address; moving to
a new address later (or a custom domain) means Back up → open new address → Restore.

## Install on an iPhone

1. Open the link in **Safari**.
2. Share button → **Add to Home Screen** → Add.
3. Always open it from the Home Screen icon.

## Updating

Edit files, bump `VERSION` in `sw.js`, commit and push. Installed apps show
"Update available — tap to reload" the next time they're opened. Never rename the repo once people use it.
