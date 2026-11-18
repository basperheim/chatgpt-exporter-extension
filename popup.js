"use strict";

const status = document.getElementById("status");
const buttons = [...document.querySelectorAll("button[data-mode]")];

async function beginExport(mode) {
  buttons.forEach((button) => {
    button.disabled = true;
  });

  status.textContent = "Preparing exporter...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (
      !tab?.id ||
      !/^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i.test(tab.url || "")
    ) {
      throw new Error("Open a conversation on chatgpt.com first.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["exporter.js"],
    });

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "CHATGPT_VISUAL_EXPORTER_START",
      mode,
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Could not start the export.");
    }

    // Close the popup so the user can interact
    // with the page's element picker.
    window.close();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);

    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

for (const button of buttons) {
  button.addEventListener("click", () => {
    void beginExport(button.dataset.mode);
  });
}
