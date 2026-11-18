"use strict";

const status = document.getElementById("status");
const formatSelect = document.getElementById("format");
const buttons = [...document.querySelectorAll("button[data-mode]")];

const savedFormat = localStorage.getItem("chatgpt-export-format");
formatSelect.value = ["pdf-light", "pdf-original", "html"].includes(savedFormat)
  ? savedFormat
  : "pdf-light";

formatSelect.addEventListener("change", () => {
  localStorage.setItem("chatgpt-export-format", formatSelect.value);
});

async function beginExport(mode) {
  buttons.forEach((button) => { button.disabled = true; });
  status.textContent = "Preparing exporter...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "CHATGPT_VISUAL_EXPORTER_START",
      mode,
      format: formatSelect.value,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not start the export.");
    }

    window.close();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    buttons.forEach((button) => { button.disabled = false; });
  }
}

for (const button of buttons) {
  button.addEventListener("click", () => {
    void beginExport(button.dataset.mode);
  });
}
