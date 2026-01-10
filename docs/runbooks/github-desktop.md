# GitHub Desktop setup

This folder (`/Users/mateo/Documents/trybl`) is currently **not** a git repository (no `.git`).

## Option A (recommended): Publish this folder as a new GitHub repo (via GitHub Desktop)
1) Open **GitHub Desktop**
2) `File → Add Local Repository…`
3) Choose this folder: `trybl`
4) If prompted, choose **Create a repository** (initialize git)
5) Commit the initial snapshot
6) Click **Publish repository**

## Option B: Initialize with command line, then open in GitHub Desktop
From the repo root:

```bash
git init
git add .
git commit -m "chore: initial import"
```

Then in GitHub Desktop:
`File → Add Local Repository…` and select the folder.

## After publishing
- Use `main` as the default branch.
- Enable branch protection rules in GitHub (recommended once you have collaborators):
  - require PR reviews
  - require status checks (CI)

