# Lingua v0.4 (Alpha)

## New in 0.4

- Added **Learn**, a local study area for translations and vocabulary that you choose to save from Phrase and Define.
- Saved Phrase translations are organized into source-to-target language folders, with individual and folder-level removal controls.
- Saved Define results are organized by word language and preserve the complete original dictionary result separately from any flashcard edit.
- Practice saved translations and vocabulary as randomized, non-repeating flashcard sessions. You can start from a folder or choose a specific item to study first.
- Flashcards support accessible flipping, keyboard navigation, progress, completion/restart controls, and pronunciation of translation sides or saved vocabulary words.
- Vocabulary card summaries show the first available definition for each part of speech. You can edit a card summary, restore its original summary, or open the complete saved result in Define without requiring a new lookup when the saved payload is valid.
- Learn pronunciation controls coordinate with Full Page Read Aloud: they stay disabled while narration is active and never interrupt it.

## Privacy and data

Learn records are stored locally in the extension's Chrome storage. Saved vocabulary retains the complete definition payload needed to restore it in Define. When a saved definition is displayed in a different interface language, Lingua uses the same existing translation-provider strategy used for displayed definition content.

# Lingua v0.3 (Alpha)

## New in 0.3

- The standalone Pronounce tab was intentionally removed: pronunciation is more useful in the context of a Define result.
- Define now has pronunciation playback, preferring matching Wiktionary/Wikimedia recordings and falling back to browser speech synthesis.
- Translate now has Full Page read-aloud for the visible original or translated main page content.
- Full Page Original/Translated switching now reuses the page’s cached text mapping, batches view requests, preserves scroll position, and avoids a new translation when the cached mapping is still available.
- Full Page read-aloud now supports Stop/Resume, Restart, estimated progress and seeking, structured narration pauses, and playback that continues when the side panel closes.
- Refined Full Page read-aloud with centralized idle, playing, paused, seeking, and finished states; Restart and Original/Translated switching now reset cleanly to the single Read aloud button without restarting speech.
- The read-aloud controls now keep Stop/Resume and Restart above a stable separate progress slider row. Seeking preserves whether narration was playing or paused, and stale cancelled-speech events no longer reset the controls.
- Define and Phrase playback controls are temporarily disabled while Full Page read-aloud owns audio, while their non-audio tools remain available.
- Define now uses Lingua’s consistent inline microphone icon for pronunciation playback.
- Full Page now resets to Original text and idle read-aloud for a reload, navigation, or browser-tab change; it waits for an explicit Translated text click on the newly active page.
- Improved the read-aloud seek slider so drag previews are not overwritten by playback updates, and expanded editorial extraction to handle deduplicated multi-article pages.
- Read Aloud now clears stale status notices after a successful start, waits briefly for browser voices, and ignores expected cancellation/interruption callbacks.
- Phrase and Define pronunciation controls are disabled only while Full Page narration is actively playing; they remain usable while it is paused.
- Fixed a shared SpeechSynthesis cancellation regression that could silence Full Page, Phrase, and Define audio or leave an inactive Full Page session appearing to play. Full Page now ignores only its own stale callbacks, releases unexpected cancellations back to an idle state, and does not cancel Phrase or Define audio while its narration is paused.
- Full Page Read Aloud now keeps semantic article headers with their associated body containers, reads qualifying consecutive articles in page order, waits briefly for hydrated body copy, and excludes media, data widgets, prompts, and non-editorial modules more reliably. Playback progress now uses monotonic millisecond checkpoints with smooth panel interpolation, preventing backward thumb/time jumps from delayed speech-boundary events.

## Privacy and data

For a Define pronunciation lookup, the word may be sent to the official Wiktionary and Wikimedia APIs to retrieve source-language phonetics and a matching recorded pronunciation. Browser speech synthesis may be used as a fallback according to the browser and device. Full Page read-aloud uses browser speech synthesis for visible webpage text.

# Lingua v0.2 (Alpha)

## New in 0.2

- Added a Definition tab for a highlighted or typed single word.
- Shows the original word, detected language, phonetic spelling, part of speech, definitions, and examples when Wiktionary provides them.
- Uses Lingua’s interface language for labels and translated definition content, while retaining the original word and source-language phonetics.
- Links each result to its Wiktionary source and credits Wiktionary content under CC BY-SA.
- Definition lookup now preserves the word’s original capitalization, supports typed-word lookup, and uses Free Dictionary API first for English before falling back to Wiktionary when needed.
- Typed words with uncertain automatic detection now probe dictionary sources and ask for a source language only when more than one valid language entry is found.
- The Definition tab is now named Define and keeps its lower result area collapsed until it has a definition, loading indicator, or helpful message to show.
- Define now prompts users to highlight or type a word, and filters incomplete Wiktionary senses so blank numbered definitions are not shown.
- Define now shows provider-supplied synonyms as accessible chips that open that synonym’s definition in place.
- Define results now keep examples with their source definition and render one final Synonyms section after all parts of speech.

## Privacy and data

For a Definition lookup, the selected or typed word may be sent to Free Dictionary API for English and to the official Wiktionary API when needed; non-English lookup uses Wiktionary. When displayed definition content needs conversion to the selected interface language, Lingua uses its existing translation-provider strategy. No lookup data is sent when no valid single word is provided.

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
- Added a compact Settings panel with interface language, text size, dark mode, and feedback controls
- Settings now localize translation language names and offer a smooth 80–140% text-size slider

## Known limitations

- Pages open in Chrome's built-in PDF viewer, `chrome://` pages and the Chrome Web Store can't be read by any extension.
- Single-page apps that change content without reloading may need the refresh icon.
- Text inside embedded frames (iframes) isn't read.
- Lingua prefers Chrome's on-device translation when supported. When it is unavailable, text is sent to Google's free endpoint, with MyMemory as a backup; these cloud services can be slow or rate-limited.
- Translations appear in the side panel. They don't replace the text on the page yet.

## Feedback

Use **Send feedback** at the bottom of the panel, or the form linked in the email you received. Bug reports with the text you tried are the most useful.
