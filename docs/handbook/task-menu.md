---
title: Task menu
description: Ready-made work packages for nonprofits. Pick one, fill in your files and details, and publish it as a GitHub issue or in your task list.
---

# Task menu

Not sure what to ask volunteers for? Start here. Each task below is small, checkable and safe, and has been written in the shape that works best for volunteers' AI. Pick one, open the [volunteer task form](/handbook/templates#github-issue-template-volunteer-task-yml) in your repository, and fill in your own files and details. A maintainer then adds the `volunteer-ready` label.

Every task still needs your **exact files**. Replace the example paths with your own.

## Website

### Make a page work on phones
- **Goal:** The page fits a 360-pixel-wide phone screen without sideways scrolling.
- **Files:** the page's HTML and CSS, e.g. `site/signup.html`, `site/signup.css`.
- **Acceptance:** at 360px wide, no horizontal scroll; every field and button visible; desktop layout unchanged.
- **Kind:** code · **Size:** small

### Speed up a slow page
- **Goal:** The home page loads noticeably faster on a phone.
- **Files:** the page and its images folder, e.g. `site/index.html`, `site/images/`.
- **Acceptance:** images are compressed and sized for display; nothing looks different; list the size before and after.
- **Kind:** code · **Size:** small

### Clearer donate or volunteer-signup page
- **Goal:** A visitor understands in five seconds how to give or sign up.
- **Files:** e.g. `site/donate.html`.
- **Acceptance:** one clear heading and button above the fold; plain-language text under 120 words; no change to payment code.
- **Kind:** code · **Size:** small

### Fix broken links
- **Goal:** No page on the website links to a page that doesn't exist.
- **Files:** the site's HTML or Markdown files, e.g. `site/*.html`.
- **Acceptance:** a list of every broken link found and how each was fixed or removed.
- **Kind:** code · **Size:** small

## Accessibility

### Add missing image descriptions
- **Goal:** Screen-reader users know what every meaningful image shows.
- **Files:** e.g. `site/index.html`, `site/about.html`.
- **Acceptance:** every meaningful image has a short, specific `alt` text; decorative images have `alt=""`.
- **Kind:** code · **Size:** small

### Make a form accessible
- **Goal:** A keyboard or screen-reader user can fill in and send the form.
- **Files:** the form's HTML and CSS.
- **Acceptance:** every field has a visible label; errors are explained in text; the whole form works with the keyboard alone; focus is visible.
- **Kind:** code · **Size:** small

### Fix colour contrast
- **Goal:** All text is readable for people with low vision.
- **Files:** the site's stylesheet, e.g. `site/styles.css`.
- **Acceptance:** body text and buttons meet WCAG AA contrast (4.5:1); the look stays recognisably the same.
- **Kind:** code · **Size:** small

## Guides and documentation

### First-shift guide for new volunteers
- **Goal:** New volunteers know where to go, what to bring and whom to ask on their first day.
- **Files:** `docs/first-shift.md` (new file).
- **Acceptance:** under 400 words; covers arrival, clothing, who to ask, and what a shift looks like; friendly tone.
- **Kind:** writing · **Size:** small

### Frequently asked questions page
- **Goal:** The ten questions your staff answer most often are answered on one page.
- **Files:** e.g. `site/faq.md` (new file). Put the questions in the steps.
- **Acceptance:** each answer is two to four sentences, in plain language, consistent with your website.
- **Kind:** writing · **Size:** small

### How-to for staff
- **Goal:** A staff member can do a routine task (e.g. publish a news post) without help.
- **Files:** e.g. `docs/how-to-publish-news.md` (new file).
- **Acceptance:** numbered steps a newcomer can follow; under 500 words.
- **Kind:** writing · **Size:** small

### Tidy up the README
- **Goal:** Anyone opening the repository understands what it is and how to help in one minute.
- **Files:** `README.md`.
- **Acceptance:** what the project is, who it serves, how to run it, how to contribute; under 400 words.
- **Kind:** writing · **Size:** small

## Translation

### Translate a page or guide
- **Goal:** The page is available in another language your community speaks.
- **Files:** e.g. `site/he/volunteer.html` (new file), from `site/volunteer.html`.
- **Acceptance:** complete translation, same structure and links; names and numbers unchanged; a native speaker will review it.
- **Kind:** writing · **Size:** small

### Translate interface text
- **Goal:** The app's buttons and messages are available in another language.
- **Files:** the translation file, e.g. `locales/es.json`.
- **Acceptance:** every key from the source file is present; placeholders like `{name}` unchanged; valid JSON.
- **Kind:** writing · **Size:** small

## Data and small tools

### Clean up a spreadsheet export
- **Goal:** A script turns your messy export into a clean, consistent file.
- **Files:** `scripts/clean_contacts.py` (new file), using a **made-up sample** like `samples/contacts-sample.csv`. Never real personal data.
- **Acceptance:** removes duplicates, fixes date formats, keeps every column; a short README explains how to run it.
- **Kind:** code · **Size:** small

### Printable sign-in sheet
- **Goal:** Staff can print an up-to-date volunteer sign-in sheet for an event.
- **Files:** e.g. `tools/signin-sheet.html` (new file).
- **Acceptance:** prints on one A4 or letter page; columns for name, time in, time out; no personal data stored.
- **Kind:** code · **Size:** small

### Calendar export for shifts
- **Goal:** Volunteers can add their shifts to their own calendar.
- **Files:** e.g. `src/calendar.ts` (new file) and its test.
- **Acceptance:** produces a valid `.ics` file; tests pass; times are correct across daylight-saving changes.
- **Kind:** code · **Size:** medium

## Code health

### Add tests for an untested function
- **Goal:** A key function is protected against future breakage.
- **Files:** the test file, e.g. `tests/test_shifts.py`.
- **Acceptance:** tests cover normal cases and at least two edge cases; all tests pass; no change to the function itself.
- **Kind:** code · **Size:** small

### Fix one reported bug
- **Goal:** The bug described in issue #N no longer happens.
- **Files:** the file with the bug and its test.
- **Acceptance:** a test that failed before the fix passes after it; nothing else changes.
- **Kind:** code · **Size:** small

### Update one outdated dependency
- **Goal:** One library is on a supported version.
- **Files:** e.g. `package.json`, `package-lock.json`.
- **Acceptance:** all tests pass; the library's changelog was checked for breaking changes and noted in the hand-in.
- **Kind:** code · **Size:** small

## Research

### Compare tools for a need
- **Goal:** You can choose a tool for a need (e.g. a volunteer scheduling app) with the facts in one place.
- **Files:** e.g. `research/scheduling-tools.md` (new file).
- **Acceptance:** three to five options with cost, nonprofit discounts, languages, privacy and a source link for each claim.
- **Kind:** writing · **Size:** small

### Contribute back to an open-source tool you use
- **Goal:** A translation or fix you need is offered to the tool's own project.
- **Files:** notes in e.g. `research/contribution-plan.md` (new file) first; the contribution itself goes to the other project.
- **Acceptance:** the tool's contributing rules are followed and linked.
- **Kind:** writing · **Size:** small

## Tasks that don't belong here

Leave these out: anything needing passwords, real personal data, payments, access to live systems, legal or medical advice, or a big redesign. Split large ideas into several small tasks with `dependsOn`.
