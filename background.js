"use strict";

/**
 * Generate a searchable PDF from the standalone HTML with Chrome's native
 * Page.printToPDF engine. Only a temporary about:blank tab is debugged;
 * the original ChatGPT conversation is not modified or debugged.
 */
async function createPdfDownload(html, filename) {
  const temporaryTab = await chrome.tabs.create({
    url: "about:blank",
    active: false,
  });

  if (!temporaryTab.id) {
    throw new Error("Could not open a temporary print tab.");
  }

  const target = { tabId: temporaryTab.id };
  let attached = false;

  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(target, "Page.enable");

    const tree = await chrome.debugger.sendCommand(
      target,
      "Page.getFrameTree"
    );
    const frameId = tree?.frameTree?.frame?.id;
    if (!frameId) throw new Error("Could not find the PDF print frame.");

    await chrome.debugger.sendCommand(
      target,
      "Page.setDocumentContent",
      { frameId, html }
    );

    // Let images and fonts settle before starting Chrome's print pipeline.
    // Time out rather than waiting forever for blocked/private images.
    await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: [
        "(async () => {",
        "  const images = Array.from(document.images);",
        "  const ready = Promise.all([",
        "    document.fonts.ready,",
        "    ...images.map((img) => img.complete ? Promise.resolve() :",
        "      new Promise((resolve) => {",
        "        img.addEventListener('load', resolve, { once: true });",
        "        img.addEventListener('error', resolve, { once: true });",
        "      }))",
        "  ]);",
        "  await Promise.race([ready,",
        "    new Promise((resolve) => setTimeout(resolve, 12000))]);",
        "  return true;",
        "})()"
      ].join("\n"),
      awaitPromise: true,
      returnByValue: true,
    });

    const result = await chrome.debugger.sendCommand(
      target,
      "Page.printToPDF",
      {
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        transferMode: "ReturnAsBase64",
      }
    );
    if (!result?.data) {
      throw new Error("Chrome returned an empty PDF.");
    }

    const downloadId = await chrome.downloads.download({
      url: "data:application/pdf;base64," + result.data,
      filename,
      saveAs: false,
      conflictAction: "uniquify",
    });
    if (typeof downloadId !== "number") {
      throw new Error("Chrome could not start the PDF download.");
    }
    return downloadId;
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch (error) {
        console.warn("Could not detach PDF debugger:", error);
      }
    }
    try {
      await chrome.tabs.remove(temporaryTab.id);
    } catch {
      // The user may have closed the temporary tab already.
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CHATGPT_VISUAL_EXPORTER_PRINT_PDF") return;

  if (
    !sender.tab?.id ||
    !/^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i.test(sender.tab.url || "")
  ) {
    sendResponse({ ok: false, error: "PDF export must start from ChatGPT." });
    return;
  }

  if (
    typeof message.html !== "string" ||
    !message.html.startsWith("<!doctype html>") ||
    typeof message.filename !== "string" ||
    !/^[a-z0-9][a-z0-9-]*\.pdf$/i.test(message.filename)
  ) {
    sendResponse({ ok: false, error: "Invalid PDF export request." });
    return;
  }

  void createPdfDownload(message.html, message.filename)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("PDF generation failed:", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });

  return true;
});
