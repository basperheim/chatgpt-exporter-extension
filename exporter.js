(() => {
  "use strict";

  // This content script lives in Chrome's isolated extension world.
  // Re-injecting it from the popup must not add another message listener.
  if (globalThis.__chatgptVisualExporterLoaded) return;
  globalThis.__chatgptVisualExporterLoaded = true;

  const CONFIG = {
    autoScroll: true,
    scrollDelayMs: 180,
    maximumScrollSteps: 700,
    pageSize: "letter",
    pageMargin: "12mm",
    removeUIControls: true,
    showSpeakerLabels: true,
    defaultPrintTheme: "light",
  };

  const STYLE_PROPERTIES = [
    "display",
    "position",
    "box-sizing",
    "flex",
    "flex-direction",
    "flex-wrap",
    "align-items",
    "align-self",
    "justify-content",
    "justify-self",
    "place-items",
    "gap",
    "row-gap",
    "column-gap",
    "grid-template-columns",
    "grid-template-rows",
    "grid-column",
    "grid-row",
    "margin",
    "padding",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "color",
    "opacity",
    "border",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-radius",
    "border-spacing",
    "box-shadow",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-variant",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-decoration",
    "text-transform",
    "text-indent",
    "text-overflow",
    "text-underline-offset",
    "vertical-align",
    "white-space",
    "overflow-wrap",
    "word-break",
    "list-style-type",
    "object-fit",
    "object-position",
    "aspect-ratio",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "transform",
  ];

  const UI_SELECTORS = [
    ".turn-action-controls",
    "[data-turn-disclosure-button]",
    "[data-chatgpt-agent-turn-start]",
    '[aria-label="Copy message"]',
    '[aria-label="Share prompt"]',
    '[aria-label="Edit message"]',
    '[class*="Edges-"][aria-hidden="true"]',
  ];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve));

  const escapeHTML = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  let busy = false;
  let notice = null;
  let outputFormat = "html";

  function showNotice(message, isError = false) {
    if (!notice) {
      notice = document.createElement("div");
      notice.dataset.chatgptExporterUI = "notice";
      notice.setAttribute("role", "status");

      notice.style.cssText = [
        "all:initial",
        "position:fixed",
        "z-index:2147483647",
        "right:18px",
        "bottom:18px",
        "max-width:360px",
        "box-sizing:border-box",
        "padding:12px 16px",
        "border-radius:9px",
        "font:13px/1.45 system-ui,sans-serif",
        "box-shadow:0 4px 18px #0005",
        "pointer-events:none",
      ].join(";");

      document.documentElement.appendChild(notice);
    }

    notice.style.background = isError ? "#a12222" : "#222";
    notice.style.color = "#fff";
    notice.textContent = message;
  }

  function hideNotice() {
    notice?.remove();
    notice = null;
  }

  const TURN_SELECTOR =
    "[data-turn-key], [data-testid='conversation-turn']";

  /**
   * ChatGPT is a single-page application: older conversations can remain
   * mounted after navigating to a new URL. Find the current thread by ID
   * before using visual positioning as a fallback.
   */
  function getCurrentConversationId() {
    const match = location.pathname.match(/(?:^|\/)c\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getTurnConversationId(turn) {
    const selectors = [
      "[data-chatgpt-selection-conversation-id]",
      "[data-chatgpt-conversation-selection-target]",
      "[data-conversation-id]",
    ];

    for (const selector of selectors) {
      const element = turn.matches(selector)
        ? turn
        : turn.querySelector(selector);

      if (!element) continue;

      for (const attribute of [
        "data-chatgpt-selection-conversation-id",
        "data-chatgpt-conversation-selection-target",
        "data-conversation-id",
      ]) {
        const id = element.getAttribute(attribute);
        if (id) return id;
      }
    }

    return null;
  }

  function isRenderedTurn(turn) {
    if (!turn.isConnected || turn.getClientRects().length === 0) {
      return false;
    }

    for (
      let current = turn;
      current && current !== document.documentElement;
      current = current.parentElement
    ) {
      if (
        current.hidden ||
        current.inert ||
        current.getAttribute("aria-hidden") === "true"
      ) {
        return false;
      }

      const style = getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      ) {
        return false;
      }
    }

    return true;
  }

  function intersectsViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < innerHeight &&
      rect.right > 0 && rect.left < innerWidth;
  }

  function findConversationRoot() {
    const expectedId = getCurrentConversationId();
    const allTurns = [...document.querySelectorAll(TURN_SELECTOR)];
    const renderedTurns = allTurns.filter(isRenderedTurn);

    // Prefer the active conversation ID over document order.
    // ChatGPT exposes the ID on some (but not necessarily all) turns.
    const matchingTurns = expectedId
      ? renderedTurns.filter(
          (turn) => getTurnConversationId(turn) === expectedId
        )
      : [];

    const onScreen = (matchingTurns.length ? matchingTurns : renderedTurns)
      .filter(intersectsViewport);

    const anchor = onScreen.at(-1) || matchingTurns.at(-1) || null;

    if (!anchor) {
      throw new Error(
        "Cannot identify the current conversation. Scroll to a message " +
        "and try again, or reload the ChatGPT tab."
      );
    }

    if (
      expectedId &&
      !matchingTurns.length &&
      renderedTurns.some(
        (turn) => {
          const id = getTurnConversationId(turn);
          return id && id !== expectedId;
        }
      )
    ) {
      throw new Error(
        "ChatGPT still shows another conversation in its DOM. " +
        "Reload this chat and try again."
      );
    }

    const scroller = findScroller(anchor);
    const root = scroller === document.scrollingElement ||
      scroller === document.documentElement
      ? anchor.closest("main") || scroller
      : scroller;

    return { root, anchor, expectedId, path: location.pathname };
  }

  function findScroller(element) {
    let current = element;

    while (current && current !== document.documentElement) {
      const style = getComputedStyle(current);

      if (
        /(auto|scroll)/.test(style.overflowY) &&
        current.scrollHeight > current.clientHeight + 100
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return document.scrollingElement || document.documentElement;
  }

  function getTurnRole(turn) {
    const author = turn.matches("[data-message-author-role]")
      ? turn
      : turn.querySelector("[data-message-author-role]");

    const rawRole = author?.getAttribute("data-message-author-role");

    if (rawRole === "user" || rawRole === "assistant") {
      return rawRole;
    }

    const role = turn
      .querySelector("[data-conversation-role]")
      ?.getAttribute("data-conversation-role");

    return role === "user" || role === "assistant" ? role : "unknown";
  }

  /**
   * Clone the source element while preserving computed styles.
   *
   * Original ChatGPT classes are stripped so the exported document
   * can work without loading the application's stylesheets.
   */
  function cloneWithStyles(source) {
    const clone = source.cloneNode(true);

    const originals = [source, ...source.querySelectorAll("*")];

    const copies = [clone, ...clone.querySelectorAll("*")];

    for (let index = 0; index < originals.length; index++) {
      const original = originals[index];
      const copied = copies[index];
      const computed = getComputedStyle(original);

      const isUIControl =
        CONFIG.removeUIControls && original.matches(UI_SELECTORS.join(","));

      copied.removeAttribute("style");
      copied.removeAttribute("class");

      if (isUIControl) {
        copied.setAttribute("data-export-remove", "true");
      }

      // Remove inline event handlers.
      for (const attribute of [...copied.attributes]) {
        if (/^on/i.test(attribute.name)) {
          copied.removeAttribute(attribute.name);
        }
      }

      // Reconstruct visual appearance using computed styles.
      for (const property of STYLE_PROPERTIES) {
        let value = computed.getPropertyValue(property);

        if (!value) continue;

        if (property === "position" && ["fixed", "sticky"].includes(value)) {
          value = "static";
        }

        copied.style.setProperty(property, value);
      }

      // Disable animation and containment.
      copied.style.setProperty("animation", "none");
      copied.style.setProperty("transition", "none");
      copied.style.setProperty("content-visibility", "visible");
      copied.style.setProperty("contain", "none");

      // Avoid freezing viewport-dependent dimensions.
      for (const property of [
        "width",
        "height",
        "min-width",
        "min-height",
        "max-height",
        "overflow",
      ]) {
        copied.style.removeProperty(property);
      }

      // Make ChatGPT component grids responsive.
      if (original.getAttribute("data-d-component") === "grid") {
        const tracks = computed.gridTemplateColumns
          .split(/\s+/)
          .filter(Boolean);

        const count = Math.max(1, Math.min(tracks.length, 4));

        copied.style.setProperty(
          "grid-template-columns",
          `repeat(${count}, minmax(0, 1fr))`,
        );
      }

      // Preserve image URLs and dimensions.
      if (original instanceof HTMLImageElement) {
        copied.removeAttribute("srcset");
        copied.removeAttribute("sizes");

        copied.src = original.currentSrc || original.src;

        const rect = original.getBoundingClientRect();

        if (rect.width > 0) {
          copied.style.width = `${rect.width}px`;
        }

        if (rect.height > 0) {
          copied.style.height = `${rect.height}px`;
        }

        copied.style.maxWidth = "100%";
      }

      // Canvas buffers are not copied by cloneNode().
      // Replace with a PNG snapshot where possible.
      if (original instanceof HTMLCanvasElement) {
        try {
          const image = document.createElement("img");

          image.src = original.toDataURL("image/png");
          image.style.cssText = copied.style.cssText;

          const rect = original.getBoundingClientRect();

          image.style.width = `${rect.width}px`;
          image.style.height = `${rect.height}px`;
          image.style.maxWidth = "100%";

          copied.replaceWith(image);
        } catch (error) {
          console.warn("ChatGPT exporter: cannot capture canvas", error);
        }
      }

      // Preserve SVG dimensions where CSS supplies sizing.
      if (
        original instanceof SVGElement &&
        original.tagName.toLowerCase() === "svg"
      ) {
        const rect = original.getBoundingClientRect();

        if (!original.hasAttribute("width") && rect.width) {
          copied.setAttribute("width", rect.width);
        }

        if (!original.hasAttribute("height") && rect.height) {
          copied.setAttribute("height", rect.height);
        }
      }
    }

    // Remove application scripts, UI controls, and picker overlays.
    clone
      .querySelectorAll(
        "script, [data-export-remove='true'], [data-chatgpt-exporter-ui]",
      )
      .forEach((element) => element.remove());

    // Identify small SVG icons for optional print recoloring.
    for (const svg of clone.querySelectorAll("svg")) {
      const width = Number.parseFloat(svg.getAttribute("width")) || 0;

      const height = Number.parseFloat(svg.getAttribute("height")) || 0;

      if (!(width > 0 && height > 0 && width <= 32 && height <= 32)) {
        continue;
      }

      svg.classList.add("export-icon");

      for (const node of [svg, ...svg.querySelectorAll("*")]) {
        const fill = node.style.getPropertyValue("fill").trim();
        const stroke = node.style.getPropertyValue("stroke").trim();

        if (fill && fill !== "none" && fill !== "transparent") {
          node.classList.add("export-icon-fill");
        }

        if (stroke && stroke !== "none" && stroke !== "transparent") {
          node.classList.add("export-icon-stroke");
        }
      }
    }

    // Replace screen-reader role labels with readable headings.
    for (const heading of clone.querySelectorAll("[data-conversation-role]")) {
      if (!CONFIG.showSpeakerLabels) {
        heading.remove();
        continue;
      }

      const role = heading.getAttribute("data-conversation-role");

      heading.removeAttribute("hidden");

      heading.textContent = role === "assistant" ? "ChatGPT" : "You";

      heading.removeAttribute("style");
      heading.className = "export-speaker";
    }

    return clone;
  }

  /**
   * Locate conversation turns.
   *
   * Prefer data-turn-key because it provides stable identifiers
   * when the conversation uses virtualized scrolling.
   */
  function getTurns(context) {
    const { root, expectedId } = context;
    const keyed = [...root.querySelectorAll("[data-turn-key]")];
    const turns = (keyed.length
      ? keyed
      : [...root.querySelectorAll("[data-testid='conversation-turn']")]
    ).filter(isRenderedTurn);

    if (!expectedId) return turns;

    // Some turns do not carry an ID, so don't silently mix threads
    // when a SPA transition leaves more than one mounted in this root.
    const ids = new Set(
      turns.map(getTurnConversationId).filter(Boolean)
    );

    if (ids.size > 0 && !ids.has(expectedId)) {
      throw new Error(
        "The active chat hasn't finished mounting. " +
        "Reload this conversation and retry."
      );
    }

    if (ids.size > 1) {
      throw new Error(
        "Multiple conversations are mounted together. " +
        "Reload this conversation before exporting."
      );
    }

    return turns;
  }

  function turnKey(turn, index) {
    return (
      turn.getAttribute("data-turn-key") ||
      turn.getAttribute("data-turn-id") ||
      turn.id ||
      `fallback-${index}-${(turn.textContent || "").trim().slice(0, 120)}`
    );
  }

  /**
   * Capture currently mounted conversation turns.
   */
  function captureVisibleTurns(context, capturedTurns) {
    const turns = getTurns(context);

    for (let index = 0; index < turns.length; index++) {
      const turn = turns[index];
      const key = turnKey(turn, index);
      const content = turn.textContent?.trim() || "";

      if (!content && !turn.querySelector("img, svg, canvas")) {
        continue;
      }

      const existing = capturedTurns.get(key);

      if (existing && existing.textLength >= content.length) {
        continue;
      }

      capturedTurns.set(key, {
        element: cloneWithStyles(turn),
        textLength: content.length,
        role: getTurnRole(turn),
      });
    }

    return turns.length;
  }

  /**
   * Scroll through the conversation to collect virtualized turns.
   */
  async function captureConversation(context) {
    const capturedTurns = new Map();
    const scroller = findScroller(context.anchor);

    const initialScrollTop = scroller.scrollTop;
    const initialScrollBehavior = scroller.style.scrollBehavior;

    scroller.style.scrollBehavior = "auto";

    try {
      scroller.scrollTop = 0;

      await sleep(CONFIG.scrollDelayMs);
      await nextFrame();

      const step = Math.max(250, Math.floor(scroller.clientHeight * 0.7));

      let previousPosition = -1;
      let unchangedCount = 0;

      for (let index = 0; index < CONFIG.maximumScrollSteps; index++) {
        if (location.pathname !== context.path) {
          throw new Error("The active conversation changed during export.");
        }
        captureVisibleTurns(context, capturedTurns);

        if (index % 5 === 0) {
          showNotice(`Scanning conversation: ${capturedTurns.size} turns...`);
        }

        const maxScroll = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight,
        );

        if (scroller.scrollTop >= maxScroll - 2) {
          await sleep(CONFIG.scrollDelayMs);
          captureVisibleTurns(context, capturedTurns);
          break;
        }

        const nextPosition = Math.min(maxScroll, scroller.scrollTop + step);

        scroller.scrollTop = nextPosition;

        await sleep(CONFIG.scrollDelayMs);
        await nextFrame();

        const actualPosition = scroller.scrollTop;

        unchangedCount =
          Math.abs(actualPosition - previousPosition) < 2
            ? unchangedCount + 1
            : 0;

        if (unchangedCount >= 3) {
          break;
        }

        previousPosition = actualPosition;
      }

      captureVisibleTurns(context, capturedTurns);
    } finally {
      scroller.scrollTop = initialScrollTop;
      scroller.style.scrollBehavior = initialScrollBehavior;
    }

    if (capturedTurns.size === 0) {
      throw new Error(
        "No conversation turns found. Try 'Pick a message' instead.",
      );
    }

    // Assemble captured turns outside the virtual-scroller structure.
    const documentRoot = document.createElement("main");
    documentRoot.className = "export-document";

    for (const item of capturedTurns.values()) {
      const section = document.createElement("section");

      section.className = "export-turn";
      section.dataset.exportRole = item.role;

      section.appendChild(item.element);
      documentRoot.appendChild(section);
    }

    return {
      documentRoot,
      count: capturedTurns.size,
    };
  }

  /**
   * Export only a selected message or component.
   */
  function captureSelection(element) {
    const documentRoot = document.createElement("main");
    documentRoot.className = "export-document";

    const section = document.createElement("section");
    section.className = "export-turn";
    section.dataset.exportRole = getTurnRole(element);

    section.appendChild(cloneWithStyles(element));
    documentRoot.appendChild(section);

    return {
      documentRoot,
      count: 1,
    };
  }

  /**
   * Construct standalone CSS with original and light PDF modes.
   */
  function makeCSS(isDark) {
    const background = isDark ? "#0b0b0b" : "#ffffff";
    const foreground = isDark ? "#f5f5f5" : "#171717";

    return `
      :root {
        color-scheme: ${isDark ? "dark" : "light"};
      }

      html {
        box-sizing: border-box;
        background: ${background};
        color: ${foreground};
      }

      *,
      *::before,
      *::after {
        box-sizing: inherit;
      }

      body {
        margin: 0;
        padding: 32px 24px;
        background: ${background};
        color: ${foreground};
        font-family: -apple-system, BlinkMacSystemFont,
          "Segoe UI", Arial, sans-serif;
        font-size: 16px;
        line-height: 1.55;
      }

      .export-document {
        width: 100%;
        max-width: 900px;
        margin: 0 auto;
        min-width: 0;
      }

      .export-turn {
        display: block;
        width: 100%;
        min-width: 0;
        max-width: 100%;
        height: auto;
        margin-bottom: 36px;
        overflow: visible;
        contain: none;
        content-visibility: visible;
      }

      .export-speaker {
        display: block;
        position: static;
        visibility: visible;
        width: auto;
        height: auto;
        margin: 24px 0 10px;
        padding: 0;
        overflow: visible;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.4;
        opacity: .7;
      }

      img,
      svg,
      canvas {
        max-width: 100%;
      }

      /*
       * Captured ChatGPT flex/grid wrappers can inherit a min-content width
       * from a long, unwrapped code line. This makes an entire user message
       * wider than the export page and clips its left edge when right-aligned.
       */
      .export-turn,
      .export-turn * {
        min-width: 0 !important;
      }

      .export-turn :is(
        div, section, article, main, aside, figure, blockquote,
        p, ul, ol, li, pre
      ) {
        max-width: 100% !important;
      }

      .export-turn {
        overflow-wrap: anywhere;
      }

      /*
       * Computed inline styles take precedence over ordinary CSS. Override
       * them explicitly so fenced code wraps in standalone HTML and PDF,
       * without discarding indentation or intentional line breaks.
       */
      .export-turn pre,
      .export-turn pre *,
      .export-turn code {
        white-space: pre-wrap !important;
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }

      .export-turn pre {
        width: 100% !important;
        max-width: 100% !important;
        overflow-x: visible !important;
      }

      table {
        max-width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        overflow-wrap: anywhere;
      }

      [data-d-component="grid"] > * {
        min-width: 0;
      }

      [data-turn-key],
      [data-measured-turn],
      [data-virtualized-turn-content] {
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        contain: none !important;
        content-visibility: visible !important;
      }

      /* Toolbar in exported HTML */

      .export-toolbar {
        position: relative;
        z-index: 5;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 8px;
        max-width: 900px;
        margin: 0 auto 24px;
        padding: 12px;
        border-radius: 10px;
        background: ${isDark ? "#222" : "#f1f1f1"};
        color: ${foreground};
        font-size: 14px;
      }

      .export-toolbar button {
        font: inherit;
        font-weight: 600;
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid #777;
        background: ${isDark ? "#333" : "#fff"};
        color: ${foreground};
        cursor: pointer;
      }

      .export-toolbar button:hover {
        outline: 2px solid #777;
        outline-offset: 1px;
      }

      /* Print layout */

      @page {
        size: ${CONFIG.pageSize};
        margin: ${CONFIG.pageMargin};
      }

      @media print {
        .export-toolbar {
          display: none !important;
        }

        html,
        body {
          width: auto !important;
          min-width: 0 !important;
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        html,
        body,
        body * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        .export-document {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        .export-turn {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          height: auto !important;
          margin-bottom: 20px !important;
          overflow: visible !important;
          break-inside: auto;
        }

        [data-d-table-viewport],
        [data-d-component="table"] {
          overflow: visible !important;
          max-width: 100% !important;
        }

        table {
          width: 100% !important;
          max-width: 100% !important;
          table-layout: auto !important;
        }

        th,
        td {
          white-space: normal !important;
          overflow-wrap: anywhere !important;
          word-break: normal !important;
          break-inside: avoid;
        }

        tr {
          break-inside: avoid;
        }

        pre,
        code {
          white-space: pre-wrap !important;
          overflow-wrap: anywhere !important;
        }

        h1,
        h2,
        h3,
        h4,
        .export-speaker {
          break-after: avoid;
        }

        p,
        li {
          orphans: 3;
          widows: 3;
        }

        img,
        svg,
        figure {
          break-inside: avoid;
        }

        [data-d-component="grid"] {
          max-width: 100% !important;
          min-width: 0 !important;
        }

        [data-d-component="grid"] > * {
          min-width: 0 !important;
        }

        [data-d-component="box"],
        [data-d-component="row"],
        [data-d-component="col"] {
          max-width: 100%;
        }

        .export-keep-together {
          break-inside: avoid;
        }

        a {
          color: inherit;
          text-decoration: underline;
        }

        /* Light print mode:
           override captured dark inline styles. */

        html[data-print-theme="light"] {
          color-scheme: light !important;
          background: #fff !important;
          color: #111 !important;
        }

        html[data-print-theme="light"] body {
          background: #fff !important;
          color: #111 !important;
        }

        html[data-print-theme="light"] body *:not(svg):not(svg *) {
          color: #111 !important;
          background-color: transparent !important;
          background-image: none !important;
          box-shadow: none !important;
          text-shadow: none !important;
          -webkit-text-fill-color: #111 !important;
          text-decoration-color: #111 !important;
        }

        html[data-print-theme="light"] .export-speaker {
          color: #111 !important;
          opacity: 1 !important;
        }

        html[data-print-theme="light"] .export-turn[data-export-role="user"] {
          border-left: 2px solid #aaa !important;
          padding-left: 12px !important;
        }

        html[data-print-theme="light"] .export-document
        :is(pre, code, table, th, td, blockquote) {
          border-color: #ccc !important;
        }

        html[data-print-theme="light"] .export-document
        .export-icon .export-icon-fill {
          fill: #222 !important;
        }

        html[data-print-theme="light"] .export-document
        .export-icon .export-icon-stroke {
          stroke: #222 !important;
        }

        html[data-print-theme="light"] .export-document
        .export-icon {
          color: #222 !important;
        }
      }
    `;
  }

  /**
   * Rebuild captured content as passive HTML, SVG and MathML. Never copy
   * arbitrary elements/attributes into the standalone print document.
   */
  function sanitizeExportContent(root, baseURL) {
    const htmlNS = "http://www.w3.org/1999/xhtml";
    const svgNS = "http://www.w3.org/2000/svg";
    const mathNS = "http://www.w3.org/1998/Math/MathML";
    const xlinkNS = "http://www.w3.org/1999/xlink";
    const words = (value) => new Set(value.split(/\s+/));
    const htmlTags = words("a abbr article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr");
    const svgTags = words("svg g path rect circle ellipse line polyline polygon text tspan textPath defs symbol use image clipPath mask linearGradient radialGradient stop pattern marker title desc filter feBlend feColorMatrix feComponentTransfer feComposite feFlood feGaussianBlur feMerge feMergeNode feOffset feFuncR feFuncG feFuncB feFuncA feDropShadow feMorphology feTurbulence feDisplacementMap");
    const mathTags = words("math mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd semantics");
    const dropTags = words("script style link meta base iframe frame frameset object embed applet portal fencedframe template noscript noembed noframes textarea input select option optgroup datalist canvas video audio source track foreignobject annotation annotation-xml");
    const commonAttrs = words("id class title role dir lang aria-label aria-hidden aria-labelledby aria-describedby aria-level data-d-component data-d-has-border data-d-table-viewport data-turn-key data-measured-turn data-virtualized-turn-content data-export-role");
    const htmlAttrs = words("alt width height colspan rowspan span scope headers start reversed value datetime open type");
    const svgAttrs = words("viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry width height d points pathLength transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule mask filter marker-start marker-mid marker-end vector-effect text-anchor dominant-baseline alignment-baseline dx dy rotate textLength lengthAdjust font-size font-family font-weight font-style gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity fx fy fr patternUnits patternContentUnits patternTransform markerWidth markerHeight markerUnits refX refY orient maskUnits maskContentUnits clipPathUnits filterUnits primitiveUnits in in2 result stdDeviation mode type values operator k1 k2 k3 k4 flood-color flood-opacity tableValues slope intercept amplitude exponent scale xChannelSelector yChannelSelector baseFrequency numOctaves seed stitchTiles radius");
    const mathAttrs = words("display mathvariant mathsize mathcolor mathbackground stretchy symmetric fence separator largeop movablelimits accent accentunder lspace rspace minsize maxsize linethickness columnalign rowalign columnspacing rowspacing columnspan rowspan notation width height depth voffset");
    const styleProperties = new Set([...STYLE_PROPERTIES, "width", "height", "min-width", "min-height", "max-width", "max-height", "overflow", "overflow-x", "overflow-y", "top", "left", "right", "bottom", "border-collapse", "border-color", "border-width", "border-style", "visibility", "z-index", "list-style-position", "fill-opacity", "stroke-opacity", "clip-path", "mask", "filter"]);
    const fragment = /^#[A-Za-z0-9_.:-]+$/;
    const localPaint = /^url\(\s*["']?#[A-Za-z0-9_.:-]+["']?\s*\)$/i;
    const safeDocument = document.implementation.createHTMLDocument("");

    function safeURL(value, kind) {
      const raw = value.trim();
      if (fragment.test(raw) && kind !== "image") return raw;
      if (kind === "local") return null;
      if (kind === "image" && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=\s]+$/i.test(raw)) return raw;
      try {
        const url = new URL(raw, baseURL);
        if (url.username || url.password) return null;
        if (url.protocol === "https:" || (kind === "link" && url.protocol === "http:")) return url.href;
      } catch {
        // Invalid or unsupported URL.
      }
      return null;
    }

    function passiveCSS(value) {
      if (/[\\<>]/.test(value)) return false;
      if (localPaint.test(value)) return true;
      return !/\b(?:url|image-set|image|cross-fade|paint|element|var|attr)\s*\(/i.test(value);
    }

    function rebuild(source) {
      if (source.nodeType === Node.TEXT_NODE) return safeDocument.createTextNode(source.data);
      if (source.nodeType !== Node.ELEMENT_NODE) return null;
      const ns = source.namespaceURI;
      const tag = source.localName;
      if (dropTags.has(tag.toLowerCase())) return null;
      if (ns !== htmlNS && ns !== svgNS && ns !== mathNS) return null;
      if (ns === svgNS && !svgTags.has(tag)) return null;
      if (ns === mathNS && !mathTags.has(tag)) return null;
      // Unsupported HTML containers (including forms and buttons) become
      // passive divs rather than retaining their interactive behavior.
      const outputTag = ns === htmlNS && !htmlTags.has(tag) ? "div" : tag;
      const output = safeDocument.createElementNS(ns, outputTag);

      for (const attribute of source.attributes) {
        const name = attribute.localName;
        const value = attribute.value;
        if (name === "style") continue;
        if (name === "href" && (attribute.namespaceURI === null || attribute.namespaceURI === xlinkNS)) {
          const kind = ns === svgNS && (tag === "use" || tag === "textPath" || tag === "linearGradient" || tag === "radialGradient" || tag === "pattern") ? "local" : ns === svgNS && tag === "image" ? "image" : tag === "a" ? "link" : null;
          const url = kind && safeURL(value, kind);
          if (url) output.setAttribute("href", url);
          continue;
        }
        if (attribute.namespaceURI !== null) continue;
        if (ns === htmlNS && tag === "img" && name === "src") {
          const url = safeURL(value, "image");
          if (url) output.setAttribute("src", url);
          continue;
        }
        if (commonAttrs.has(name) || (ns === htmlNS && htmlAttrs.has(name)) || (ns === svgNS && svgAttrs.has(name) && passiveCSS(value)) || (ns === mathNS && mathAttrs.has(name) && passiveCSS(value))) {
          output.setAttribute(name, value);
        }
      }
      if (source.style && output.style) {
        for (const property of source.style) {
          const value = source.style.getPropertyValue(property);
          if (styleProperties.has(property) && passiveCSS(value)) {
            output.style.setProperty(property, value, source.style.getPropertyPriority(property));
          }
        }
      }
      if (ns === htmlNS && tag === "a") output.setAttribute("rel", "noopener noreferrer");
      if ((ns === htmlNS && tag === "img") || (ns === svgNS && tag === "image")) output.setAttribute("referrerpolicy", "no-referrer");
      for (const child of source.childNodes) {
        const clean = rebuild(child);
        if (clean) output.appendChild(clean);
      }
      return output;
    }

    const clean = rebuild(root);
    if (!clean || clean.localName !== "main") throw new Error("Invalid export document root.");
    return clean;
  }

  /**
   * Build the standalone HTML document.
   */
  function buildHTML({ documentRoot, count }, printTheme = CONFIG.defaultPrintTheme) {
    const computed = getComputedStyle(document.documentElement);

    const isDark =
      document.documentElement.classList.contains("dark") ||
      document.body.classList.contains("dark") ||
      document.documentElement.dataset.theme === "dark" ||
      computed.colorScheme.includes("dark") ||
      getComputedStyle(document.body).backgroundColor === "rgb(0, 0, 0)";

    // Discourage page splits inside smaller diagrams.
    for (const element of documentRoot.querySelectorAll(
      '[data-d-component="box"][data-d-has-border]',
    )) {
      if (
        element.textContent.length > 0 &&
        element.textContent.length < 1200 &&
        !element.querySelector('[data-d-component="table"]')
      ) {
        element.classList.add("export-keep-together");
      }
    }

    const sanitizedRoot = sanitizeExportContent(documentRoot, document.baseURI);
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const contentSecurityPolicy = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "img-src https: data:",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "connect-src 'none'",
    ].join("; ");

    const toolbar = `
      <nav class="export-toolbar" aria-label="PDF export options">
        <strong>PDF appearance:</strong>
        <button type="button" data-export-print-theme="light">
          Print light PDF
        </button>
        <button type="button" data-export-print-theme="original">
          Print original PDF
        </button>
      </nav>`;

    const printScript = `
      (() => {
        for (
          const button of document.querySelectorAll(
            ".export-toolbar > button[data-export-print-theme]"
          )
        ) {
          button.addEventListener("click", () => {
            const theme = button.getAttribute("data-export-print-theme");
            if (theme !== "light" && theme !== "original") return;
            document.documentElement.setAttribute("data-print-theme", theme);

            window.print();
          });
        }
      })();`;

    const outputHTML = [
      "<!doctype html>",
      `<html lang="en" data-print-theme="${printTheme}">`,
      "<head>",
      '<meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${escapeHTML(contentSecurityPolicy)}">`,
      '<meta name="referrer" content="no-referrer">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHTML(document.title || "ChatGPT Conversation")}</title>`,
      `<style>${makeCSS(isDark)}</style>`,
      "</head>",
      "<body>",
      toolbar,
      sanitizedRoot.outerHTML,
      `<script nonce="${nonce}">${printScript}</script>`,
      "</body>",
      "</html>",
    ].join("\n");

    return {
      outputHTML,
      count,
    };
  }


  /**
   * Resolve the title of the active thread, not an arbitrary sidebar entry.
   * Use textContent; the nested markup itself is not part of the title.
   */
  function getConversationTitle() {
    const currentPath = location.pathname.replace(/\/$/, "");
    const link = [...document.querySelectorAll("a[href]")].find((node) => {
      try {
        const url = new URL(node.href, location.href);
        return url.origin === location.origin &&
          url.pathname.replace(/\/$/, "") === currentPath &&
          node.querySelector('[data-thread-title="true"]');
      } catch {
        return false;
      }
    });

    const titleElement = link?.querySelector(
      '[data-thread-title="true"] [data-marquee-content="true"] [dir="auto"]'
    ) || link?.querySelector('[data-thread-title="true"]');

    const title = titleElement?.textContent?.trim();
    const tabTitle = document.title.replace(/\s*[-–|]\s*ChatGPT\s*$/i, "").trim();

    return title || (tabTitle && !/^chatgpt$/i.test(tabTitle)
      ? tabTitle
      : "ChatGPT Conversation");
  }

  function makeExportFilename(extension, scope = "conversation") {
    const slug = getConversationTitle()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90)
      .replace(/-+$/g, "") || "chatgpt-conversation";

    return slug + (scope === "conversation" ? "" : "-" + scope) + "." + extension;
  }

  async function saveExport(result, scope) {
    if (outputFormat === "html") {
      downloadHTML(result.outputHTML, makeExportFilename("html", scope));
      showNotice("HTML downloaded. Open it to choose a PDF style.");
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "CHATGPT_VISUAL_EXPORTER_PRINT_PDF",
      html: result.outputHTML,
      filename: makeExportFilename("pdf", scope),
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not create the PDF.");
    }

    showNotice("PDF download started.");
  }

  /**
   * Download HTML directly from the page.
   */
  function downloadHTML(outputHTML, filename) {
    const blob = new Blob([outputHTML], { type: "text/html;charset=utf-8" });

    const objectURL = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectURL;
    anchor.download = filename;
    anchor.style.display = "none";

    document.documentElement.appendChild(anchor);

    anchor.click();
    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(objectURL);
    }, 30000);
  }

  /**
   * Export a single message or component.
   */
  async function exportSelection(element, scope = "element") {
    if (busy) return;

    busy = true;
    showNotice("Exporting selected content...");

    try {
      await nextFrame();

      const theme = outputFormat === "pdf-original" ? "original" : "light";
      const result = buildHTML(captureSelection(element), theme);
      await saveExport(result, scope);

      setTimeout(hideNotice, 6000);
    } catch (error) {
      console.error("ChatGPT export failed", error);

      showNotice(`Export failed: ${error.message || error}`, true);

      setTimeout(hideNotice, 9000);
    } finally {
      busy = false;
    }
  }

  /**
   * Export an entire conversation.
   */
  async function exportConversation() {
    if (busy) return;

    busy = true;
    showNotice("Scanning ChatGPT conversation...");

    try {
      const context = findConversationRoot();

      const captured = CONFIG.autoScroll
        ? await captureConversation(context)
        : captureSelection(context.root);

      const theme = outputFormat === "pdf-original" ? "original" : "light";
      const result = buildHTML(captured, theme);
      await saveExport(result, "conversation");

      setTimeout(hideNotice, 6000);
    } catch (error) {
      console.error("ChatGPT export failed", error);

      showNotice(`Export failed: ${error.message || error}`, true);

      setTimeout(hideNotice, 9000);
    } finally {
      busy = false;
    }
  }

  /**
   * Start an interactive picker.
   *
   * The user can select a conversation message or
   * a specific rendered component by clicking it.
   *
   * Escape cancels the operation.
   */
  function startPicker(mode) {
    if (busy) return;

    busy = true;
    let hovered = null;

    const outline = document.createElement("div");
    outline.dataset.chatgptExporterUI = "picker";

    outline.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483646",
      "border:2px solid #10a37f",
      "border-radius:4px",
      "background:rgba(16,163,127,.1)",
      "box-sizing:border-box",
      "left:0",
      "top:0",
      "width:0",
      "height:0",
    ].join(";");

    document.documentElement.appendChild(outline);

    showNotice("Move your mouse to highlight. Click to export; Esc cancels.");

    function choiceFor(element) {
      if (
        !(element instanceof Element) ||
        element.closest("[data-chatgpt-exporter-ui]")
      ) {
        return null;
      }

      if (mode === "message") {
        return element.closest(
          "[data-turn-key], [data-testid='conversation-turn']",
        );
      }

      return (
        element.closest("[data-d-component]") ||
        element.closest(
          "pre, table, figure, blockquote, p, h1, h2, h3, ul, ol",
        ) ||
        element
      );
    }

    function move(event) {
      const candidate = choiceFor(event.target);

      if (!candidate) return;

      hovered = candidate;

      const rect = candidate.getBoundingClientRect();

      Object.assign(outline.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }

    function cleanup() {
      document.removeEventListener("pointermove", move, true);

      document.removeEventListener("click", choose, true);

      document.removeEventListener("keydown", onKeydown, true);

      outline.remove();
    }

    function choose(event) {
      const chosen = choiceFor(event.target) || hovered;

      if (!chosen) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      cleanup();

      // The picker is no longer active.
      // The export function now manages busy state.
      busy = false;

      void exportSelection(chosen, mode);
    }

    function onKeydown(event) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      event.stopImmediatePropagation();

      cleanup();

      busy = false;
      hideNotice();
    }

    document.addEventListener("pointermove", move, true);

    document.addEventListener("click", choose, true);

    document.addEventListener("keydown", onKeydown, true);
  }

  /**
   * Receive commands from the extension popup.
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "CHATGPT_VISUAL_EXPORTER_START") {
      return;
    }

    if (busy) {
      sendResponse({
        ok: false,
        error: "An export or element picker is already active.",
      });

      return;
    }

    if (!["html", "pdf-light", "pdf-original"].includes(message.format)) {
      sendResponse({ ok: false, error: "Unknown export format." });
      return;
    }
    outputFormat = message.format;

    if (message.mode === "conversation") {
      void exportConversation();
    } else if (message.mode === "message" || message.mode === "element") {
      startPicker(message.mode);
    } else {
      sendResponse({
        ok: false,
        error: "Unknown export mode.",
      });

      return;
    }

    sendResponse({ ok: true });
  });
})();
