---
title: What our GitHub App can and can't do
description: The exact permissions of the Volunteer Pool GitHub App, what it does with them, what it never does, and how to remove it.
---

# What our GitHub App can and can't do

To deliver volunteers' work, Volunteer Pool uses a small GitHub App. Before you install it, here's exactly what it can and can't do. **You don't have to trust us on this:** GitHub shows the same list on the install screen, the code is public, and your own settings stop anything else.

## Install it on chosen repositories only

When you install the app, choose **Only select repositories** and pick the ones volunteers should work on. The app can't see any other repository. Install it from [github.com/apps/volunteer-compute-broker](https://github.com/apps/volunteer-compute-broker).

## The permissions, in plain words

| Permission | Why we need it | What we do with it |
|---|---|---|
| **Contents: read and write** | To read the project's files for volunteers, and to save a volunteer's change on a new branch | Read files; create branches named `volunteer/…` with one commit each |
| **Pull requests: read and write** | To propose the change to you | Open a pull request, update its description, comment when a revision arrives or a review is overdue |
| **Issues: read** | To find tasks you published as issues | Read issues labelled `volunteer-ready`, and who added the label |
| **Checks: read** | To show you whether your tests passed | Read the result of your CI on volunteer pull requests |
| **Metadata: read** | Required by GitHub for every app | Repository name, default branch, collaborators' permission level |

It listens for these GitHub events: pull requests (merged or closed), pull request reviews, check suites and installations.

## What it never does

- **Never merges.** Only you do.
- **Never writes to your main branch.** It only creates its own `volunteer/…` branches. With a [branch ruleset](/handbook/secure-your-repository), GitHub itself blocks direct changes to main, for us and everyone else.
- **Never touches `.github/`**: your workflows, settings and templates. Such changes are refused before they reach GitHub.
- **Never reads your secrets.** GitHub Apps can't read Actions secrets.
- **Never changes settings, members or permissions**, and never deletes anything.
- **Never acts on its own.** Every branch and pull request comes from a volunteer's hand-in to a task you published.

Everything the app does appears in your repository's history under the name `volunteer-compute-broker[bot]`.

## Check it yourself

- The app's code is open: [src/github-app.ts](https://github.com/yonatan-langer83/volunteer-compute-broker/blob/main/src/github-app.ts) holds every call it makes to GitHub.
- On GitHub, *Settings → Integrations → GitHub Apps → Volunteer Compute Broker* shows its permissions and the repositories it can access.

## Remove it any time

*Settings → Integrations → GitHub Apps → Volunteer Compute Broker → Configure*, then remove a repository or uninstall it. Open volunteer pull requests stay, as normal pull requests you can merge or close. Tell us too, so volunteers aren't sent work that can't arrive.

## If we ever need more

Any new permission has to be approved by you on GitHub before it takes effect. We'll say why in plain words first.
