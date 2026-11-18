# Publishing ChatGPT Visual Exporter

## Before submission

1. Test the current-thread export after switching between chats without a
   page reload. It must export only the active thread or give a clear error.
2. Confirm HTML, light PDF, original-color PDF, message picking, and element picking.
3. Test short and long chats with images and tables.
4. Ensure `manifest.json` has a unique, incremented version number.
5. Supply a publicly accessible privacy policy and a contact/support method.
   A private GitHub repository cannot serve as a public support page.
6. Read and verify Chrome Web Store's current developer policies before release.

## Store enrollment

- Visit https://chrome.google.com/webstore/devconsole.
- Register as a Chrome Web Store developer, pay the one-time registration fee,
  and enable 2-step verification on your Google account.
- Complete developer contact and account verification steps as prompted.

## Package the extension

Run from the repository root:

```sh
zip -r chatgpt-visual-exporter-v1.1.1.zip \
  manifest.json popup.html popup.js exporter.js background.js icons
```

The ZIP must contain `manifest.json` at its root. Do not zip an enclosing
folder or include `.git`.

## Upload and store listing

1. In the developer dashboard choose to add a new item, then upload the ZIP.
2. Set a clear description and the Productivity category.
3. Upload `icons/icon128.png` as the store icon (128×128 PNG). The manifest's
   `icons` values already control icons inside the installed extension.
4. Supply at least one screenshot (1280×800 preferred; 640×400 also accepted).
5. Add a promotional tile if the dashboard requires one.
6. Add a home page and support contact if available.
7. Complete Privacy practices with accurate permissions justifications,
   remote-code declaration, and data handling details.
8. Select distribution visibility, then submit for review. Review may take
   longer for extensions with broad permissions.

## Permission justifications

- `activeTab`: Allow export only when the user invokes the extension on
  an open ChatGPT tab.
- `scripting`: Inject the content-capture script into that tab.
- `debugger`: Temporarily attach to an inactive blank tab and invoke Chrome
  DevTools Protocol `Page.printToPDF`. Never debug the source ChatGPT tab.
- `downloads`: Save the resulting PDF with the conversation title.

The `debugger` permission is powerful and may trigger a prominent warning or
additional scrutiny. Explain why it is necessary and disclose it honestly.

## Privacy considerations

The extension reads the conversation's rendered DOM to build exports locally.
It does not send message text to an extension-operated remote server. However,
embedded image URLs and other resources in the exported HTML can still trigger
requests to their original hosts. Users control the generated local files.
Avoid claiming that exported HTML is guaranteed fully offline.

The store's privacy disclosure and publicly linked policy must match the code.

## References

- https://developer.chrome.com/docs/webstore/register/
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing/
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/
- https://developer.chrome.com/docs/webstore/program-policies/policies/
