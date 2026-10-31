# Lingua v0.1 (Alpha)

First installable preview. **Translate** is the only tab that works so far.

## Install (about 3 minutes, desktop Chrome 116 or newer)

1. Download **lingua-alpha-v0.1.zip** from the Assets list at the bottom of this release.
2. Unzip it. You'll get a folder called `lingua-extension` with a `manifest.json` file inside.
3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked** and select the `lingua-extension` folder.
6. Click the puzzle-piece icon in the toolbar, pin **Lingua**, then click it to open the side panel.

Chrome may show a "disable developer mode extensions" notice on startup. That's expected for an unreleased extension. Just dismiss it.

## How to use it

**Full page**
Open any article or website and open Lingua. It reads the page automatically and translates it. Switch to another tab and it re-reads that page. Use the refresh icon if a page changes after it loads.

**Phrase**
Select *Phrase*, then highlight text on the page with your cursor. It appears in the Original text box and is translated right away. You can also type or paste text into the box.

**Both modes**
- Pick the language you want to translate into. In Phrase mode, you can also choose the source language or leave it on *Detect language*.
- The swap button flips the two languages.
- Copy the result, or press the speaker icon to hear it read aloud.
- Your last five phrase translations appear under *Recent translations*.

## What's in 0.1

- Full page and Phrase translation modes
- 44 languages, listed alphabetically, with automatic language detection
- Long pages are split up and translated in pieces (first 12,000 characters of a page)
- Phrases up to 5,000 characters
- Copy and listen buttons, recent translations
- Simplified side-panel branding to avoid a duplicate Lingua header
- Full page translation now detects the source language, translates readable page text in place, and can restore the original text
- Full page translation now persists per-tab state across panel closing and same-URL reloads, reports percentage progress, and translates safe visible labels in links, buttons, tabs, and menus
- Full page translation now batches repeated page text, uses a queued request flow, and waits before retrying temporary translation-service limits
- Full page translation now handles missing page state, unsupported pages, and temporary provider limits without leaving the panel in an error state
- Lingua now prefers Chrome's on-device Translator and Language Detector APIs when supported, with the existing cloud providers as fallbacks

## Known limitations

- Pages open in Chrome's built-in PDF viewer, `chrome://` pages and the Chrome Web Store can't be read by any extension.
- Single-page apps that change content without reloading may need the refresh icon.
- Text inside embedded frames (iframes) isn't read.
- Lingua prefers Chrome's on-device translation when supported. When it is unavailable, text is sent to Google's free endpoint, with MyMemory as a backup; these cloud services can be slow or rate-limited.
- Translations appear in the side panel. They don't replace the text on the page yet.

## Feedback

Use **Send feedback** at the bottom of the panel, or the form linked in the email you received. Bug reports with the text you tried are the most useful.
