---
title: Admin Settings
---

# Admin Settings

This guide explains the **Settings** page for **production admins** using MatchZy Auto Tournament . It focuses on what you need to fill in and what each option does, without development details.

If you are running MAT in developer mode or on a test environment, see the pages under **[For Developers](../development/contributing.md)** instead.

## Webhook URL

**What it is:**  
The **Webhook URL** is the **base URL of your MAT site**. CS2 servers use it to send match events and demo uploads back to your installation.

**What to enter:**

- In **production** (real tournament), this should be your live site URL, for example:
  - `https://example.com`
  - `https://match.example.org`
- It must be reachable from your CS2 servers.

If you are unsure what to use here, ask whoever set up your hosting.  
If you are developing locally (for example using `http://localhost:4173`), that setup is covered in the [Server & Local Setup](../getting-started/server-setup.md) docs under **For Developers** and should not be configured from the live admin panel.

> **Tip:** If you see a warning that the webhook URL is not configured, go to **Settings → Webhook URL**, enter your production domain, and save.

## Default Player ELO

**What it is:**  
The **Default Player ELO** is the starting rating for new players when no ELO is specified (for example when importing teams or using shuffle tournaments).

**How to use it:**

- Use a **positive number** (e.g. `3000`).
- All new players without an explicit ELO will start at this value.
- You can adjust it later if you change how competitive you want your rating scale to be.

If you are not sure, keeping the default (`3000`) is a safe choice.

## Steam Web API Key (optional)

**What it is:**  
An optional **Steam Web API Key** used to:

- Resolve Steam vanity URLs to real Steam IDs.
- Pull additional player profile information.

**How to use it:**

- If you don’t need these extras, you can leave it **blank**.
- If you want to enable it:
  - Click the small icon next to the field to open the official Steam API key page.
  - Follow the instructions there, copy your key, and paste it into the **Steam Web API Key** field.

If you are unsure about API keys, ask your developer or technical contact to set this up for you.

## Map Management (Sync CS2 Maps)

**What it is:**  
The **Sync CS2 Maps** button downloads or updates the list of available CS2 maps from the official repository.

**When to use it:**

- After first install, if you don’t see the maps you expect.
- When new maps are added to the game and you want them available in tournaments.

Click **“Sync CS2 Maps”** and wait until you see a success message. Existing maps are kept; only new ones are added.

## Developer Options (visible in dev builds only)

At the bottom of the Settings page, you may see a section called **Developer Options** with a toggle like **“Simulate matches”**.

- These options are **only meant for local development and testing**.
- They should **not** be used in real tournaments.

If you are an admin running a production tournament, you can ignore this section.  
If you are a developer and want to use simulation or other experimental options, see the docs under **[For Developers](../development/contributing.md)**.
