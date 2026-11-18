# ChatGPT Visual Exporter

A lightweight Manifest V3 Chrome extension that exports ChatGPT conversations,
individual messages, and rendered elements as **standalone HTML** or
**searchable, printable PDFs**.

## Features

- Export the full conversation, a selected message, or a rendered element.
- Captures visible and virtualized conversation turns while scrolling.
- Preserves computed CSS, SVGs, tables, images, and canvas snapshots where possible.
- Printer-friendly white PDF and original-color PDF modes.
- Standalone HTML files retain buttons for both PDF print styles.
- Filenames use the active conversation title, e.g. `fix-html-exporter-themes.pdf`.
- No cloud service or external dependencies. Rendering happens locally.

## Installation

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository's folder.
4. Open a ChatGPT conversation and click the extension icon.
5. Choose **PDF — printer-friendly**, **PDF — original colors**, or
   **Standalone HTML**, then choose what to export.

## PDF permissions and privacy

Direct PDF export uses the Chrome DevTools Protocol (`Page.printToPDF`) via
the `debugger` permission and the `downloads` API. Chrome may display a
temporary debugging notice. The extension creates an inactive blank tab,
prints the captured standalone HTML, detaches the debugger, and closes
the tab. It never attaches a debugger to your original ChatGPT tab.

No conversations are uploaded to third-party servers.
Referenced external images may still be retrieved by Chrome while rendering.
Very large conversations can exceed browser messaging or data-URL download
limits; standalone HTML remains an alternative.

## Limitations

- ChatGPT's DOM structure may change and require selector updates.
- Extremely long chats should be reviewed for missed virtualized turns.
- Protected images and special embedded visuals may not reproduce perfectly.
- Light PDF mode overrides dark captured styles, including text and backgrounds.
- Direct PDF export requires Chrome's powerful `debugger` permission.

## License

No license has been added yet. Choose an open-source license before publishing.
