(function () {
  const oldLauncher = document.getElementById("cy-launcher");
  const oldToolbar = document.getElementById("cy-toolbar");
  const oldLayer = document.getElementById("cy-annotations-layer");
  if (oldLauncher) oldLauncher.remove();
  if (oldToolbar) oldToolbar.remove();
  if (oldLayer) oldLayer.remove();

  const state = {
    activeTool: null, // 'highlight' | 'pin' | 'crop'
    highlightColor: "rgba(255, 224, 102, 0.75)",
    pinSymbol: "●",
    isNumberPinMode: false,
    pinCounter: 1,
    isExportingLongImage: false, // 导出长图保护锁
    annotations: []
  };

  const SYMBOLS = [
    { label: "微点", val: "●", isNumber: false },
    { label: "序号", val: "1", isNumber: true },
    { label: "三角", val: "▲", isNumber: false },
    { label: "菱形", val: "◆", isNumber: false },
    { label: "星形", val: "★", isNumber: false },
    { label: "方块", val: "■", isNumber: false },
    { label: "旗标", val: "⚑", isNumber: false }
  ];

  const COLORS = [
    "rgba(255, 224, 102, 0.75)",
    "rgba(140, 233, 154, 0.75)",
    "rgba(116, 192, 252, 0.75)",
    "rgba(255, 169, 77, 0.75)",
    "rgba(252, 194, 215, 0.75)"
  ];

  // ================= 1. 初始化 DOM =================
  function initDOM() {
    if (!document.body) {
      window.addEventListener("DOMContentLoaded", initDOM);
      return;
    }

    const launcher = document.createElement("div");
    launcher.id = "cy-launcher";
    launcher.innerHTML = `<span>⚑ 采邑</span>`;
    document.body.appendChild(launcher);

    const toolbar = document.createElement("div");
    toolbar.id = "cy-toolbar";
    toolbar.className = "cy-hidden";
    toolbar.innerHTML = `
      <div class="cy-drag-handle" id="cy-drag">⠿</div>
      <div class="cy-tool-group" style="display:flex;align-items:center;gap:4px;">
        <button class="cy-btn" id="cy-btn-highlight">涂色</button>
        <button class="cy-btn" id="cy-btn-pin">标点</button>
        <button class="cy-btn" id="cy-btn-crop">截图</button>
        <button class="cy-btn" id="cy-btn-export">导出 ▾</button>
      </div>
      <button class="cy-btn" id="cy-btn-close" style="padding: 4px 8px; font-size: 11px; color: var(--cy-text-secondary);">✕ 收起</button>

      <div class="cy-popover" id="cy-color-popover">
        ${COLORS.map((c, i) => `<div class="cy-color-dot ${i === 0 ? 'active' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
      </div>

      <div class="cy-popover" id="cy-symbol-popover">
        ${SYMBOLS.map(s => `<div class="cy-symbol-item" data-val="${s.val}" data-is-number="${s.isNumber}">${s.val}</div>`).join('')}
      </div>

      <div class="cy-popover" id="cy-export-popover">
        <button class="cy-dropdown-btn" id="cy-opt-digest-img">📑 导出摘录 (左右图卷)</button>
        <button class="cy-dropdown-btn" id="cy-opt-long-img">📜 导出长图 (靠右不遮挡)</button>
        <button class="cy-dropdown-btn" id="cy-opt-grid-img">🍱 导出宫图 (现代极简展陈)</button>
        <button class="cy-dropdown-btn" id="cy-opt-md">📝 导出 Markdown (.md)</button>
        <button class="cy-dropdown-btn" id="cy-opt-doc">📄 导出 Word 文档 (.doc)</button>
      </div>
    `;
    document.body.appendChild(toolbar);

    const layer = document.createElement("div");
    layer.id = "cy-annotations-layer";
    document.body.appendChild(layer);

    restorePositions(toolbar, launcher);
    bindEvents();
    initDraggable(toolbar, document.getElementById("cy-drag"), "cy_toolbar_pos");
    initLauncherDraggable(launcher);
    initGhostMode();

    // 穿透捕获所有局部与全局滚动事件
    window.addEventListener("scroll", handleScrollSync, true);
    window.addEventListener("resize", () => relayoutCards());

    window.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        const tb = document.getElementById("cy-toolbar");
        const lc = document.getElementById("cy-launcher");
        if (tb.classList.contains("cy-hidden")) {
          lc.classList.add("cy-hidden");
          tb.classList.remove("cy-hidden");
        } else {
          tb.classList.add("cy-hidden");
          lc.classList.remove("cy-hidden");
        }
      }
    });
  }

  // ================= 2. 真实视口实时投射算法（支持长图导出保护） =================
  let scrollTicking = false;
  function handleScrollSync() {
    if (state.isExportingLongImage) return; // 导出长图期间跳过常规重绘
    if (!scrollTicking) {
      window.requestAnimationFrame(() => {
        relayoutCards();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }

  function relayoutCards() {
    if (state.isExportingLongImage) return;

    const cards = Array.from(document.querySelectorAll(".cy-card"));
    if (cards.length === 0) return;

    const cardsData = [];

    cards.forEach(card => {
      const id = card.dataset.id;
      const targets = document.querySelectorAll(`[data-cy-id="${id}"]`);
      let viewportY = -9999;
      let inScreen = false;

      if (targets.length > 0) {
        const rect = targets[0].getBoundingClientRect();
        viewportY = rect.top;
        if (rect.bottom >= 0 && rect.top <= window.innerHeight) {
          inScreen = true;
        }
      }

      cardsData.push({
        card,
        viewportY,
        inScreen,
        height: card.offsetHeight || 80
      });
    });

    cardsData.sort((a, b) => a.viewportY - b.viewportY);

    let currentBottomY = 24;

    cardsData.forEach(item => {
      if (!item.inScreen) {
        item.card.style.opacity = "0";
        item.card.style.pointerEvents = "none";
        return;
      }

      const idealTop = Math.max(24, item.viewportY);
      const computedTop = Math.max(idealTop, currentBottomY);

      item.card.style.opacity = "1";
      item.card.style.pointerEvents = "auto";
      item.card.style.top = `${Math.round(computedTop)}px`;

      currentBottomY = computedTop + item.height + 10;
    });
  }

  // ================= 3. 胶囊与工具栏双重位置记忆与拖拽 =================
  function restorePositions(toolbar, launcher) {
    const applyPos = (el, pos) => {
      if (!pos || !el) return;
      const left = Math.min(Math.max(10, pos.left), window.innerWidth - (el.offsetWidth || 100));
      const top = Math.min(Math.max(10, pos.top), window.innerHeight - 50);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.bottom = "auto";
      el.style.transform = "none";
    };

    try {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["cy_toolbar_pos", "cy_launcher_pos"], (res) => {
          if (res) {
            if (res.cy_toolbar_pos) applyPos(toolbar, res.cy_toolbar_pos);
            if (res.cy_launcher_pos) applyPos(launcher, res.cy_launcher_pos);
          }
        });
      } else {
        const tPos = localStorage.getItem("cy_toolbar_pos");
        const lPos = localStorage.getItem("cy_launcher_pos");
        if (tPos) applyPos(toolbar, JSON.parse(tPos));
        if (lPos) applyPos(launcher, JSON.parse(lPos));
      }
    } catch (e) {}
  }

  function savePos(storageKey, left, top) {
    const pos = { left, top };
    try {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [storageKey]: pos });
      } else {
        localStorage.setItem(storageKey, JSON.stringify(pos));
      }
    } catch (e) {
      localStorage.setItem(storageKey, JSON.stringify(pos));
    }
  }

  function initDraggable(el, handle, storageKey) {
    let isDragging = false, startX, startY, initLeft, initTop;

    handle.addEventListener("mousedown", (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      el.style.left = `${initLeft + (e.clientX - startX)}px`;
      el.style.top = `${initTop + (e.clientY - startY)}px`;
      el.style.bottom = "auto";
      el.style.transform = "none";
    }

    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      const rect = el.getBoundingClientRect();
      savePos(storageKey, rect.left, rect.top);
    }
  }

  function initLauncherDraggable(launcher) {
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, initLeft, initTop;

    launcher.addEventListener("mousedown", (e) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = launcher.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;

      launcher.classList.add("cy-dragging");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        hasMoved = true;
      }

      if (hasMoved) {
        launcher.style.left = `${initLeft + dx}px`;
        launcher.style.top = `${initTop + dy}px`;
        launcher.style.bottom = "auto";
        launcher.style.transform = "none";
      }
    }

    function onMouseUp(e) {
      if (!isDragging) return;
      isDragging = false;
      launcher.classList.remove("cy-dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      if (hasMoved) {
        const rect = launcher.getBoundingClientRect();
        savePos("cy_launcher_pos", rect.left, rect.top);
        e.stopPropagation();
      } else {
        const toolbar = document.getElementById("cy-toolbar");
        launcher.classList.add("cy-hidden");
        toolbar.classList.remove("cy-hidden");
      }
    }
  }

  function initGhostMode() {
    const launcher = document.getElementById("cy-launcher");
    if (!launcher) return;

    let idleTimer = null;
    const resetIdle = () => {
      launcher.style.opacity = "";
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!launcher.matches(":hover") && !launcher.classList.contains("cy-hidden") && !launcher.classList.contains("cy-dragging")) {
          launcher.style.opacity = "0.2";
        }
      }, 3000);
    };

    window.addEventListener("scroll", resetIdle, true);
    window.addEventListener("mousemove", resetIdle, { passive: true });
    resetIdle();
  }

  // ================= 4. 交互与面板管理 =================
  function bindEvents() {
    const launcher = document.getElementById("cy-launcher");
    const toolbar = document.getElementById("cy-toolbar");
    const highlightBtn = document.getElementById("cy-btn-highlight");
    const pinBtn = document.getElementById("cy-btn-pin");
    const cropBtn = document.getElementById("cy-btn-crop");
    const exportBtn = document.getElementById("cy-btn-export");
    const colorPopover = document.getElementById("cy-color-popover");
    const symbolPopover = document.getElementById("cy-symbol-popover");
    const exportPopover = document.getElementById("cy-export-popover");

    toolbar.querySelectorAll(".cy-btn, .cy-color-dot, .cy-symbol-item, .cy-dropdown-btn").forEach(el => {
      el.addEventListener("mousedown", (e) => e.preventDefault());
    });

    document.getElementById("cy-btn-close").addEventListener("click", () => {
      resetToolState();
      toolbar.classList.add("cy-hidden");
      launcher.classList.remove("cy-hidden");
    });

    highlightBtn.addEventListener("click", () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) {
        executeHighlightSelection(selection);
        return;
      }
      toggleTool("highlight", highlightBtn);
      colorPopover.style.display = state.activeTool === "highlight" ? "flex" : "none";
      symbolPopover.style.display = "none";
      exportPopover.style.display = "none";
    });

    pinBtn.addEventListener("click", () => {
      toggleTool("pin", pinBtn);
      symbolPopover.style.display = state.activeTool === "pin" ? "flex" : "none";
      colorPopover.style.display = "none";
      exportPopover.style.display = "none";
    });

    cropBtn.addEventListener("click", () => {
      resetToolState();
      startAreaCrop();
    });

    exportBtn.addEventListener("click", () => {
      resetToolState();
      exportPopover.style.display = exportPopover.style.display === "flex" ? "none" : "flex";
    });

    document.getElementById("cy-opt-digest-img").addEventListener("click", () => {
      exportPopover.style.display = "none";
      exportAnnotatedExcerptsImage();
    });

    document.getElementById("cy-opt-long-img").addEventListener("click", () => {
      exportPopover.style.display = "none";
      exportFullPageLongImage();
    });

    document.getElementById("cy-opt-grid-img").addEventListener("click", () => {
      exportPopover.style.display = "none";
      exportWebpageGongGridCollage();
    });

    document.getElementById("cy-opt-md").addEventListener("click", () => {
      exportPopover.style.display = "none";
      exportDocument("md");
    });

    document.getElementById("cy-opt-doc").addEventListener("click", () => {
      exportPopover.style.display = "none";
      exportDocument("doc");
    });

    colorPopover.addEventListener("click", (e) => {
      const dot = e.target.closest(".cy-color-dot");
      if (!dot) return;
      colorPopover.querySelectorAll(".cy-color-dot").forEach(d => d.classList.remove("active"));
      dot.classList.add("active");
      state.highlightColor = dot.dataset.color;
    });

    symbolPopover.addEventListener("click", (e) => {
      const item = e.target.closest(".cy-symbol-item");
      if (!item) return;
      const isNum = item.dataset.isNumber === "true";
      state.isNumberPinMode = isNum;

      if (isNum) {
        state.pinSymbol = String(state.pinCounter);
      } else {
        state.pinSymbol = item.dataset.val;
      }
      symbolPopover.style.display = "none";
    });

    document.addEventListener("mouseup", handlePageMouseUp);
  }

  function toggleTool(toolName, btnElement) {
    if (state.activeTool === toolName) {
      resetToolState();
    } else {
      resetToolState();
      state.activeTool = toolName;
      btnElement.classList.add("cy-active");
    }
  }

  function resetToolState() {
    state.activeTool = null;
    document.querySelectorAll(".cy-btn").forEach(b => b.classList.remove("cy-active"));
    document.getElementById("cy-color-popover").style.display = "none";
    document.getElementById("cy-symbol-popover").style.display = "none";
    document.getElementById("cy-export-popover").style.display = "none";
  }

  // ================= 5. 涂色高亮 =================
  function executeHighlightSelection(selection) {
    const text = selection.toString().trim();
    if (!text) return;

    const range = selection.getRangeAt(0);
    const id = "cy-hl-" + Date.now();
    const spans = highlightRangeCrossNodes(range, state.highlightColor, id);

    if (spans && spans.length > 0) {
      selection.removeAllRanges();
      addAnnotationItem({
        id: id,
        type: "涂色",
        content: text,
        badge: "T",
        color: state.highlightColor
      });
      spans.forEach(span => bindNodeToCard(span, id));
    }
  }

  function highlightRangeCrossNodes(range, color, id) {
    if (!range || range.collapsed) return null;
    const commonAncestor = range.commonAncestorContainer;
    const root = commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentNode : commonAncestor;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    if (textNodes.length === 0) return null;

    const createdSpans = [];
    for (let i = textNodes.length - 1; i >= 0; i--) {
      const node = textNodes[i];
      let startOffset = 0;
      let endOffset = node.nodeValue.length;

      if (node === range.startContainer) startOffset = range.startOffset;
      if (node === range.endContainer) endOffset = range.endOffset;
      if (startOffset >= endOffset) continue;

      const subRange = document.createRange();
      subRange.setStart(node, startOffset);
      subRange.setEnd(node, endOffset);

      const span = document.createElement("mark");
      span.className = "cy-highlight-node";
      span.dataset.cyId = id;
      span.style.setProperty("background-color", color, "important");
      span.style.setProperty("color", "inherit", "important");

      const fragment = subRange.extractContents();
      span.appendChild(fragment);
      subRange.insertNode(span);
      createdSpans.push(span);
    }
    return createdSpans;
  }

  // ================= 6. 原文标点 =================
  function handlePageMouseUp(e) {
    if (e.target.closest("#cy-toolbar") || e.target.closest("#cy-launcher") || e.target.closest("#cy-annotations-layer")) return;

    if (state.activeTool === "highlight") {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) executeHighlightSelection(selection);
      return;
    }

    if (state.activeTool === "pin") {
      const id = "cy-pin-" + Date.now();
      const pin = document.createElement("div");
      pin.className = "cy-pin-node";

      let currentBadge = state.pinSymbol;
      if (state.isNumberPinMode) {
        currentBadge = String(state.pinCounter);
        pin.innerText = currentBadge;

        state.pinCounter++;
        state.pinSymbol = String(state.pinCounter);
        const numItem = document.querySelector(`.cy-symbol-item[data-is-number="true"]`);
        if (numItem) numItem.innerText = state.pinCounter;
      } else {
        pin.innerText = currentBadge;
      }

      let targetParent = e.target;
      if (!targetParent || targetParent === document.body || targetParent === document.documentElement) {
        pin.style.left = `${e.pageX}px`;
        pin.style.top = `${e.pageY}px`;
        document.body.appendChild(pin);
      } else {
        const parentRect = targetParent.getBoundingClientRect();
        const offsetX = e.clientX - parentRect.left;
        const offsetY = e.clientY - parentRect.top;
        if (window.getComputedStyle(targetParent).position === "static") {
          targetParent.style.position = "relative";
        }
        pin.style.left = `${offsetX}px`;
        pin.style.top = `${offsetY}px`;
        targetParent.appendChild(pin);
      }

      addAnnotationItem({
        id: id,
        type: "标点",
        content: `标点 [${currentBadge}] 于 (${Math.round(e.pageX)}, ${Math.round(e.pageY)})`,
        badge: currentBadge
      });

      bindNodeToCard(pin, id);
    }
  }

  function bindNodeToCard(node, id) {
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = document.querySelector(`.cy-card[data-id="${id}"]`);
      if (card) {
        card.classList.remove("cy-card-collapsed");
        const toggleBtn = card.querySelector(".cy-card-btn-toggle");
        if (toggleBtn) toggleBtn.innerText = "▲";
        card.style.outline = "2px solid var(--cy-accent)";
        setTimeout(() => card.style.outline = "none", 1200);
      }
    });
  }

  // ================= 7. 区域截图 =================
  function startAreaCrop() {
    const mask = document.createElement("div");
    mask.id = "cy-crop-mask";
    const box = document.createElement("div");
    box.id = "cy-crop-box";
    mask.appendChild(box);
    document.body.appendChild(mask);

    let startX = 0, startY = 0, isSelecting = false;

    mask.addEventListener("mousedown", (e) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;
      box.style.left = `${startX}px`;
      box.style.top = `${startY}px`;
      box.style.width = "0px";
      box.style.height = "0px";
    });

    mask.addEventListener("mousemove", (e) => {
      if (!isSelecting) return;
      const curX = e.clientX;
      const curY = e.clientY;
      box.style.left = `${Math.min(startX, curX)}px`;
      box.style.top = `${Math.min(startY, curY)}px`;
      box.style.width = `${Math.abs(curX - startX)}px`;
      box.style.height = `${Math.abs(curY - startY)}px`;
    });

    mask.addEventListener("mouseup", () => {
      isSelecting = false;
      const rect = box.getBoundingClientRect();
      mask.remove();

      if (rect.width < 10 || rect.height < 10) return;

      const id = "cy-crop-" + Date.now();
      const pinnedBox = document.createElement("div");
      pinnedBox.className = "cy-crop-pinned-box";
      pinnedBox.dataset.cyId = id;
      pinnedBox.style.left = `${rect.left + window.scrollX}px`;
      pinnedBox.style.top = `${rect.top + window.scrollY}px`;
      pinnedBox.style.width = `${rect.width}px`;
      pinnedBox.style.height = `${rect.height}px`;
      document.body.appendChild(pinnedBox);

      const toolbar = document.getElementById("cy-toolbar");
      toolbar.style.opacity = "0";

      setTimeout(() => {
        chrome.runtime.sendMessage({ action: "CAPTURE_VISIBLE_TAB" }, (response) => {
          toolbar.style.opacity = "1";

          if (response && response.dataUrl) {
            cropImage(response.dataUrl, rect, (croppedDataUrl) => {
              addAnnotationItem({
                id: id,
                type: "截图",
                content: `截图选区 (${Math.round(rect.width)} × ${Math.round(rect.height)})`,
                thumb: croppedDataUrl,
                badge: "◩"
              });
              bindNodeToCard(pinnedBox, id);
            });
          }
        });
      }, 70);
    });
  }

  function cropImage(dataUrl, rect, callback) {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const scaleX = img.naturalWidth / window.innerWidth;
      const scaleY = img.naturalHeight / window.innerHeight;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(rect.width * scaleX));
      canvas.height = Math.max(1, Math.round(rect.height * scaleY));
      const ctx = canvas.getContext("2d");

      ctx.drawImage(
        img,
        rect.left * scaleX,
        rect.top * scaleY,
        rect.width * scaleX,
        rect.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );
      callback(canvas.toDataURL("image/png"));
    };
  }

  // ================= 8. 批注卡片管理 =================
  function addAnnotationItem(item) {
    item.timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    item.note = "";
    state.annotations.push(item);
    renderCard(item);
  }

  function renderCard(item) {
    const layer = document.getElementById("cy-annotations-layer");
    const card = document.createElement("div");
    card.className = "cy-card";
    card.dataset.id = item.id;

    card.innerHTML = `
      <div class="cy-card-header">
        <span>${item.badge} · ${item.type} · ${item.timestamp}</span>
        <div class="cy-card-actions">
          <button class="cy-card-btn cy-card-btn-toggle" title="折叠/展开">▲</button>
          <button class="cy-card-btn cy-card-btn-del" title="删除">✕</button>
        </div>
      </div>
      ${item.thumb ? `
        <div class="cy-card-img-wrap">
          <img class="cy-card-img-thumb" src="${item.thumb}" alt="截图" />
          <button class="cy-btn-img-save" data-id="${item.id}">⬇ 保存此截图</button>
        </div>
      ` : `<div class="cy-card-body">${item.content}</div>`}
      <textarea class="cy-card-textarea" placeholder="输入批注笔记..."></textarea>
    `;

    if (item.thumb) {
      const saveBtn = card.querySelector(".cy-btn-img-save");
      saveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        safeDownloadFile(item.thumb, `采邑截图_${Date.now()}.png`);
      });
      const imgThumb = card.querySelector(".cy-card-img-thumb");
      imgThumb.onload = () => relayoutCards();
    }

    const toggleBtn = card.querySelector(".cy-card-btn-toggle");
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isCollapsed = card.classList.toggle("cy-card-collapsed");
      toggleBtn.innerText = isCollapsed ? "▼" : "▲";
      relayoutCards();
    });

    const textarea = card.querySelector(".cy-card-textarea");
    textarea.addEventListener("input", (e) => {
      item.note = e.target.value;
      relayoutCards();
    });

    card.addEventListener("click", (e) => {
      if (e.target.tagName === "TEXTAREA" || e.target.classList.contains("cy-card-btn") || e.target.classList.contains("cy-btn-img-save")) return;
      const target = document.querySelector(`[data-cy-id="${item.id}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.style.transition = "filter 0.2s ease";
        target.style.filter = "drop-shadow(0 0 8px rgba(37, 99, 235, 0.6))";
        setTimeout(() => target.style.filter = "none", 800);
      }
    });

    card.querySelector(".cy-card-btn-del").addEventListener("click", () => {
      const idx = state.annotations.findIndex(a => a.id === item.id);
      if (idx !== -1) state.annotations.splice(idx, 1);
      document.querySelectorAll(`[data-cy-id="${item.id}"]`).forEach(el => el.remove());
      card.remove();
      relayoutCards();
    });

    layer.appendChild(card);
    relayoutCards();
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  function drawSymbolBadge(ctx, x, y, badgeText, size = 16) {
    const isMultiChar = badgeText.length > 1;
    const w = isMultiChar ? size + 8 : size;
    const h = size;

    ctx.save();
    ctx.fillStyle = "#ffffff";
    drawRoundedRect(ctx, x, y, w, h, 3.5);
    ctx.fill();

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = "#000000";
    ctx.font = `bold ${Math.round(size * 0.58)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeText, x + w / 2, y + h / 2);
    ctx.restore();

    ctx.textBaseline = "top";
    ctx.textAlign = "start";
    return w;
  }

  function injectScrollbarKiller() {
    const killer = document.createElement("style");
    killer.id = "cy-scrollbar-killer";
    killer.textContent = `
      html, body {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
        overflow: -moz-scrollbars-none !important;
      }
      html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar {
        width: 0px !important;
        height: 0px !important;
        display: none !important;
        background: transparent !important;
      }
    `;
    document.documentElement.appendChild(killer);
    return killer;
  }

  function safeDownloadFile(url, filename) {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }, 1500);
    } catch (e) {
      chrome.runtime.sendMessage({
        action: "DOWNLOAD_FILE",
        url: url,
        filename: filename
      });
    }
  }

  // ================= 9. 导出「摘录」（独立 Canvas 重绘，完全不受 DOM 坐标影响） =================
  async function exportAnnotatedExcerptsImage() {
    const paragraphs = extractArticleWithAnnotations();
    const annotatedParas = paragraphs.filter(p => p.annotations && p.annotations.length > 0);

    if (annotatedParas.length === 0) {
      alert("当前没有任何批注内容可供摘录导出。");
      return;
    }

    const toast = document.createElement("div");
    toast.id = "cy-progress-toast";
    toast.innerHTML = `<span>⏳ 正在生成「摘录」图卷...</span>`;
    document.body.appendChild(toast);

    await new Promise(r => setTimeout(r, 60));

    const loadedThumbs = {};
    for (let p of annotatedParas) {
      for (let a of p.annotations) {
        if (a.type === "截图" && a.thumb) {
          await new Promise(resolve => {
            const img = new Image();
            img.onload = () => { loadedThumbs[a.id] = img; resolve(); };
            img.onerror = resolve;
            img.src = a.thumb;
          });
        }
      }
    }

    const canvasW = 1080;
    const padding = 44;
    const contentW = canvasW - padding * 2;
    const leftColW = 560;
    const colGap = 24;
    const rightColW = contentW - leftColW - colGap;
    const rowGap = 22;
    const headerH = 92;
    const footerH = 56;

    const measureCanvas = document.createElement("canvas");
    const mCtx = measureCanvas.getContext("2d");

    function breakTextLinesWithIndices(text, font, maxWidth) {
      mCtx.font = font;
      const lines = [];
      let lineStart = 0;
      let currentLine = "";

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\n') {
          lines.push({ text: currentLine, start: lineStart, end: i });
          lineStart = i + 1;
          currentLine = "";
          continue;
        }
        const testLine = currentLine + char;
        if (mCtx.measureText(testLine).width > maxWidth && currentLine.length > 0) {
          lines.push({ text: currentLine, start: lineStart, end: i });
          lineStart = i;
          currentLine = char;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine.length > 0) {
        lines.push({ text: currentLine, start: lineStart, end: text.length });
      }
      return lines;
    }

    function wrapTextSimple(text, font, maxWidth) {
      mCtx.font = font;
      const lines = [];
      let currentLine = "";
      for (let char of text) {
        const testLine = currentLine + char;
        if (mCtx.measureText(testLine).width > maxWidth && currentLine.length > 0) {
          lines.push(currentLine);
          currentLine = char;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      return lines;
    }

    const plannedRows = [];
    let totalRowsHeight = 0;

    annotatedParas.forEach((p, idx) => {
      const paraFont = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      const paraLines = breakTextLinesWithIndices(p.text, paraFont, leftColW - 32);
      const paraTextH = paraLines.length * 22;
      const leftH = 40 + paraTextH + 18;

      const charHighlightColors = new Array(p.text.length).fill(null);
      p.annotations.forEach(a => {
        if (a.type === "涂色" && a.content) {
          let searchFrom = 0;
          while (searchFrom < p.text.length) {
            const pos = p.text.indexOf(a.content, searchFrom);
            if (pos === -1) break;
            for (let c = pos; c < pos + a.content.length; c++) {
              charHighlightColors[c] = a.color || "rgba(255, 224, 102, 0.75)";
            }
            searchFrom = pos + a.content.length;
          }
        }
      });

      const pinBadges = p.annotations.filter(a => a.type === "标点").map(a => a.badge);

      const plannedAnnoCards = [];
      let rightH = 14;

      p.annotations.forEach(a => {
        let cardH = 12 + 16 + 10;
        let quoteLines = [];
        let imgH = 0;

        if (a.type === "涂色") {
          quoteLines = wrapTextSimple(`“${a.content}”`, "12.5px -apple-system, sans-serif", rightColW - 32 - 24);
          cardH += quoteLines.length * 19 + 4;
        } else if (a.type === "截图" && loadedThumbs[a.id]) {
          const img = loadedThumbs[a.id];
          const dw = rightColW - 32 - 24;
          imgH = Math.min(180, dw * (img.naturalHeight / img.naturalWidth));
          cardH += imgH + 8;
        }

        let noteLines = [];
        if (a.note && a.note.trim()) {
          noteLines = wrapTextSimple(`批注: ${a.note}`, "12px -apple-system, sans-serif", rightColW - 32 - 24);
          cardH += (quoteLines.length > 0 || imgH > 0 ? 8 : 0) + noteLines.length * 18;
        }

        cardH += 12;

        plannedAnnoCards.push({
          anno: a,
          cardH,
          quoteLines,
          noteLines,
          imgH
        });

        rightH += cardH + 12;
      });

      const rowH = Math.max(leftH, rightH);
      plannedRows.push({
        idx,
        p,
        paraLines,
        charHighlightColors,
        pinBadges,
        plannedAnnoCards,
        leftH,
        rightH,
        rowH
      });

      totalRowsHeight += rowH + rowGap;
    });

    const canvasH = headerH + padding * 2 + totalRowsHeight + footerH;

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");

    ctx.textBaseline = "top";

    ctx.fillStyle = "#f3f4f7";
    ctx.fillRect(0, 0, canvasW, canvasH);

    const frameInset = 18;
    ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, frameInset, frameInset, canvasW - frameInset * 2, canvasH - frameInset * 2, 14);
    ctx.stroke();

    const pageTitle = document.title || "网页摘录";
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(`${pageTitle} · 摘录`, padding, padding + 16);

    ctx.fillStyle = "#64748b";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(`URL: ${window.location.href}  |  ARCHIVED: ${new Date().toLocaleString()}  |  共摘录 ${annotatedParas.length} 处被批注段落`, padding, padding + 48);

    ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding + 70);
    ctx.lineTo(canvasW - padding, padding + 70);
    ctx.stroke();

    let curY = padding + headerH;

    plannedRows.forEach(row => {
      const rowY = curY;

      ctx.save();
      ctx.shadowColor = "rgba(15, 23, 42, 0.07)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = "#ffffff";
      drawRoundedRect(ctx, padding, rowY, contentW, row.rowH, 12);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "rgba(15, 23, 42, 0.1)";
      ctx.strokeRect(padding, rowY, contentW, row.rowH);

      const dividerX = padding + leftColW;
      ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
      ctx.beginPath();
      ctx.moveTo(dividerX, rowY + 12);
      ctx.lineTo(dividerX, rowY + row.rowH - 12);
      ctx.stroke();

      const leftX = padding + 16;
      let leftY = rowY + 16;

      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 11px -apple-system, monospace";
      const excerptTag = `EXCERPT ${String(row.idx + 1).padStart(2, "0")}`;
      ctx.fillText(excerptTag, leftX, leftY);

      let badgeStartX = leftX + ctx.measureText(excerptTag).width + 12;
      row.pinBadges.forEach(b => {
        const badgeW = drawSymbolBadge(ctx, badgeStartX, leftY - 1, b, 16);
        badgeStartX += badgeW + 6;
      });

      leftY += 24;
      ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

      row.paraLines.forEach(line => {
        let activeColor = null;
        let runStart = -1;

        for (let i = line.start; i <= line.end; i++) {
          const color = (i < line.end) ? row.charHighlightColors[i] : null;
          if (color !== activeColor) {
            if (activeColor) {
              const startOffset = runStart - line.start;
              const endOffset = i - line.start;
              const xOffset = leftX + ctx.measureText(line.text.slice(0, startOffset)).width;
              const runW = ctx.measureText(line.text.slice(startOffset, endOffset)).width;

              ctx.save();
              ctx.fillStyle = activeColor;
              drawRoundedRect(ctx, xOffset - 1, leftY - 1, runW + 2, 19, 3);
              ctx.fill();
              ctx.restore();
            }
            activeColor = color;
            runStart = i;
          }
        }

        ctx.fillStyle = "#1e293b";
        ctx.fillText(line.text, leftX, leftY);
        leftY += 22;
      });

      const rightX = dividerX + 16;
      let rightY = rowY + 14;

      row.plannedAnnoCards.forEach(ac => {
        const aBoxW = rightColW - 32;

        ctx.fillStyle = "#f8fafc";
        drawRoundedRect(ctx, rightX, rightY, aBoxW, ac.cardH, 8);
        ctx.fill();

        ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
        ctx.strokeRect(rightX, rightY, aBoxW, ac.cardH);

        let headX = rightX + 12;
        const headY = rightY + 12;

        if (ac.anno.type === "标点") {
          const bw = drawSymbolBadge(ctx, headX, headY, ac.anno.badge, 16);
          headX += bw + 8;
        } else if (ac.anno.type === "涂色") {
          ctx.save();
          ctx.fillStyle = ac.anno.color || "#ffe066";
          drawRoundedRect(ctx, headX, headY + 1, 14, 14, 3);
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.15)";
          ctx.stroke();
          ctx.restore();
          headX += 22;
        }

        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 11.5px -apple-system, sans-serif";
        ctx.fillText(`${ac.anno.type} · ${ac.anno.timestamp}`, headX, headY);

        let bodyY = headY + 16 + 10;

        if (ac.anno.type === "涂色") {
          ctx.fillStyle = "#475569";
          ctx.font = "12.5px -apple-system, sans-serif";
          ac.quoteLines.forEach(ql => {
            ctx.fillText(ql, rightX + 12, bodyY);
            bodyY += 19;
          });
          bodyY += 4;
        } else if (ac.anno.type === "截图" && loadedThumbs[ac.anno.id]) {
          const img = loadedThumbs[ac.anno.id];
          const dw = aBoxW - 24;
          const dh = ac.imgH;
          ctx.drawImage(img, rightX + 12, bodyY, dw, dh);
          bodyY += dh + 8;
        }

        if (ac.anno.note && ac.anno.note.trim()) {
          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 12px -apple-system, sans-serif";
          ac.noteLines.forEach(nl => {
            ctx.fillText(nl, rightX + 12, bodyY);
            bodyY += 18;
          });
        }

        rightY += ac.cardH + 12;
      });

      curY += row.rowH + rowGap;
    });

    const footerY = canvasH - padding;
    ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, footerY - 14);
    ctx.lineTo(canvasW - padding, footerY - 14);
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px -apple-system, sans-serif";
    ctx.fillText(`CAIYI EXCERPT DIGEST SYSTEM · SIDE-BY-SIDE VISUAL ARCHIVE`, padding, footerY);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(15, 23, 42, 0.18)";
    ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(`CAIYI ARCHIVE // 采邑截图`, canvasW - padding, footerY);
    ctx.textAlign = "start";

    toast.innerHTML = `<span>✓ 摘录生成完毕，开始下载...</span>`;
    await new Promise(r => setTimeout(r, 140));

    const finalDataUrl = canvas.toDataURL("image/png");
    const cleanFileName = pageTitle.replace(/[\\/:*?"<>|]/g, "_");
    safeDownloadFile(finalDataUrl, `${cleanFileName}_摘录.png`);

    if (toast && toast.parentNode) toast.remove();
  }

  // ================= 10. 导出长图（加入加固锁，保证卡片绝对完整可见） =================
  async function exportFullPageLongImage() {
    if (document.getElementById("cy-progress-toast")) return;

    state.isExportingLongImage = true; // 锁定滚动计算，防止卡片被设为 opacity: 0

    const toolbar = document.getElementById("cy-toolbar");
    const launcher = document.getElementById("cy-launcher");
    toolbar.style.display = "none";
    launcher.style.display = "none";

    const scrollbarKiller = injectScrollbarKiller();

    // 强制展开所有卡片并临时保证 100% 显式可见
    const originalStates = [];
    const cards = Array.from(document.querySelectorAll(".cy-card"));
    cards.forEach(c => {
      originalStates.push({
        card: c,
        collapsed: c.classList.contains("cy-card-collapsed")
      });
      c.classList.remove("cy-card-collapsed");
      c.style.opacity = "1";
      c.style.display = "flex";
      const tBtn = c.querySelector(".cy-card-btn-toggle");
      if (tBtn) tBtn.innerText = "▲";
    });

    const toast = document.createElement("div");
    toast.id = "cy-progress-toast";
    toast.innerHTML = `<span>⏳ 采邑正在生成长图...</span>`;
    document.body.appendChild(toast);

    const origX = window.scrollX;
    const origY = window.scrollY;
    const docEl = document.documentElement;
    const bodyEl = document.body;
    const origScrollBehavior = docEl.style.scrollBehavior;
    docEl.style.scrollBehavior = "auto";

    const floatingElements = [];
    document.querySelectorAll("*").forEach(el => {
      if (el.id && el.id.startsWith("cy-")) return;
      if (el.closest && el.closest("#cy-toolbar, #cy-launcher, #cy-annotations-layer")) return;
      try {
        const style = window.getComputedStyle(el);
        if (style.position === "fixed" || style.position === "sticky") {
          floatingElements.push({ el, origVisibility: el.style.visibility });
        }
      } catch (e) {}
    });

    try {
      const totalHeight = Math.max(docEl.scrollHeight, bodyEl.scrollHeight, window.innerHeight);
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxScrollY = Math.max(0, totalHeight - viewportHeight);

      const step = Math.max(200, viewportHeight - 120);

      let canvas = null;
      let ctx = null;
      let scale = 1;
      let curY = 0;
      let sliceIndex = 0;

      while (true) {
        window.scrollTo(0, curY);
        // 关键：滚动到当前切片时，卡片精准对齐当前可视视口
        relayoutCards();
        await new Promise(r => setTimeout(r, 160));

        if (sliceIndex > 0) {
          floatingElements.forEach(f => f.el.style.visibility = "hidden");
        }

        if (toast.parentNode) toast.remove();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "CAPTURE_VISIBLE_TAB" }, resolve);
        });

        document.body.appendChild(toast);
        const percent = maxScrollY > 0 ? Math.min(100, Math.round((curY / maxScrollY) * 100)) : 100;
        toast.innerHTML = `<span>⏳ 正在截取超清画面 (${percent}%)...</span>`;

        if (!res || !res.dataUrl) {
          throw new Error(res ? res.error : "捕获切片失败");
        }

        const img = await new Promise((resolve, reject) => {
          const m = new Image();
          m.onload = () => resolve(m);
          m.onerror = reject;
          m.src = res.dataUrl;
        });

        if (!canvas) {
          scale = img.naturalWidth / viewportWidth;
          canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = Math.round(totalHeight * scale);
          ctx = canvas.getContext("2d");
        }

        const actualY = window.scrollY;
        const destY = Math.round(actualY * scale);

        if (destY + img.naturalHeight > canvas.height) {
          const newCanvas = document.createElement("canvas");
          newCanvas.width = canvas.width;
          newCanvas.height = destY + img.naturalHeight;
          const nCtx = newCanvas.getContext("2d");
          nCtx.drawImage(canvas, 0, 0);
          canvas = newCanvas;
          ctx = nCtx;
        }

        ctx.drawImage(img, 0, destY);

        if (actualY >= maxScrollY || curY >= maxScrollY) {
          const finalHeight = destY + img.naturalHeight;
          if (finalHeight < canvas.height) {
            const trimmedCanvas = document.createElement("canvas");
            trimmedCanvas.width = canvas.width;
            trimmedCanvas.height = finalHeight;
            const tCtx = trimmedCanvas.getContext("2d");
            tCtx.drawImage(canvas, 0, 0);
            canvas = trimmedCanvas;
          }
          break;
        }

        curY = Math.min(curY + step, maxScrollY);
        sliceIndex++;
      }

      toast.innerHTML = `<span>✓ 图像生成完毕，开始下载...</span>`;
      await new Promise(r => setTimeout(r, 160));

      const finalDataUrl = canvas.toDataURL("image/png");
      const pageTitle = (document.title || "采邑长图").replace(/[\\/:*?"<>|]/g, "_");
      safeDownloadFile(finalDataUrl, `${pageTitle}_完整批注长图.png`);
    } catch (err) {
      alert("生成长图失败: " + err.message);
    } finally {
      state.isExportingLongImage = false; // 解除长图导出锁
      scrollbarKiller.remove();
      floatingElements.forEach(f => f.el.style.visibility = f.origVisibility);
      window.scrollTo(origX, origY);
      docEl.style.scrollBehavior = origScrollBehavior;
      toolbar.style.display = "flex";

      originalStates.forEach(s => {
        if (s.collapsed) {
          s.card.classList.add("cy-card-collapsed");
          const tBtn = s.card.querySelector(".cy-card-btn-toggle");
          if (tBtn) tBtn.innerText = "▼";
        }
      });
      relayoutCards();

      if (toast && toast.parentNode) toast.remove();
    }
  }

  // ================= 11. 导出宫图 =================
  async function exportWebpageGongGridCollage() {
    if (document.getElementById("cy-progress-toast")) return;

    const toolbar = document.getElementById("cy-toolbar");
    const launcher = document.getElementById("cy-launcher");
    toolbar.style.display = "none";
    launcher.style.display = "none";

    const scrollbarKiller = injectScrollbarKiller();

    const toast = document.createElement("div");
    toast.id = "cy-progress-toast";
    toast.innerHTML = `<span>⏳ 正在进行高清分屏捕获...</span>`;
    document.body.appendChild(toast);

    const origX = window.scrollX;
    const origY = window.scrollY;
    const docEl = document.documentElement;
    const bodyEl = document.body;
    const origScrollBehavior = docEl.style.scrollBehavior;
    docEl.style.scrollBehavior = "auto";

    const floatingElements = [];
    document.querySelectorAll("*").forEach(el => {
      if (el.id && el.id.startsWith("cy-")) return;
      if (el.closest && el.closest("#cy-toolbar, #cy-launcher, #cy-annotations-layer")) return;
      try {
        const style = window.getComputedStyle(el);
        if (style.position === "fixed" || style.position === "sticky") {
          floatingElements.push({ el, origVisibility: el.style.visibility });
        }
      } catch (e) {}
    });

    try {
      const totalHeight = Math.max(docEl.scrollHeight, bodyEl.scrollHeight, window.innerHeight);
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const maxScrollY = Math.max(0, totalHeight - viewportHeight);

      const numScreens = Math.max(1, Math.ceil(totalHeight / viewportHeight));
      const capturedScreenImages = [];

      for (let i = 0; i < numScreens; i++) {
        const targetY = numScreens === 1 ? 0 : Math.min(i * viewportHeight, maxScrollY);
        window.scrollTo(0, targetY);

        if (i > 0) {
          floatingElements.forEach(f => f.el.style.visibility = "hidden");
        }

        if (toast.parentNode) toast.remove();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "CAPTURE_VISIBLE_TAB" }, resolve);
        });

        document.body.appendChild(toast);
        toast.innerHTML = `<span>⏳ 正在截取第 ${i + 1}/${numScreens} 屏高清画面...</span>`;

        if (!res || !res.dataUrl) {
          throw new Error(res ? res.error : "截取切片失败");
        }

        const img = await new Promise((resolve, reject) => {
          const m = new Image();
          m.onload = () => resolve(m);
          m.onerror = reject;
          m.src = res.dataUrl;
        });

        capturedScreenImages.push(img);
      }

      toast.innerHTML = `<span>⏳ 正在进行现代画廊极简装裱...</span>`;

      const totalScreens = capturedScreenImages.length;
      const cols = Math.ceil(Math.sqrt(totalScreens));
      const rows = Math.ceil(totalScreens / cols);

      const sampleImg = capturedScreenImages[0];
      const screenNativeW = sampleImg.naturalWidth;
      const screenNativeH = sampleImg.naturalHeight;
      const aspectRatio = screenNativeH / screenNativeW;

      let targetCellW = 1280;
      if (cols === 1) targetCellW = Math.min(screenNativeW, 1600);
      else if (cols === 2) targetCellW = Math.min(screenNativeW, 1400);
      else if (cols >= 3) targetCellW = Math.min(screenNativeW, 1100);

      const maxCanvasDim = 16000;
      if (cols * targetCellW > maxCanvasDim - 500) {
        targetCellW = Math.floor((maxCanvasDim - 500) / cols);
      }

      const cellWidth = targetCellW;
      const cellHeight = Math.round(cellWidth * aspectRatio);
      const cellRadius = Math.round(cellWidth * 0.015);
      const gap = Math.round(cellWidth * 0.038);
      const padding = Math.round(cellWidth * 0.055);
      const headerH = Math.round(cellWidth * 0.11);
      const footerH = Math.round(cellWidth * 0.065);

      const collageW = padding * 2 + cols * cellWidth + (cols - 1) * gap;
      const collageH = headerH + padding * 2 + rows * cellHeight + (rows - 1) * gap + footerH;

      const canvas = document.createElement("canvas");
      canvas.width = collageW;
      canvas.height = collageH;
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = "#f3f4f7";
      ctx.fillRect(0, 0, collageW, collageH);

      const frameInset = Math.round(padding * 0.38);
      ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, frameInset, frameInset, collageW - frameInset * 2, collageH - frameInset * 2, Math.round(cellRadius * 1.4));
      ctx.stroke();

      const pageTitle = document.title || "采邑网页切片归档";
      const titleFontSize = Math.round(cellWidth * 0.024);
      ctx.fillStyle = "#0f172a";
      ctx.font = `bold ${titleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(pageTitle, padding, padding + Math.round(headerH * 0.32));

      const metaFontSize = Math.round(cellWidth * 0.0125);
      ctx.fillStyle = "#64748b";
      ctx.font = `${metaFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillText(`SOURCE: ${window.location.href}  |  TIMESTAMP: ${new Date().toLocaleString()}  |  SPEC: ${cols}×${rows} GRID (${totalScreens} SCREENS)`, padding, padding + Math.round(headerH * 0.62));

      ctx.strokeStyle = "rgba(15, 23, 42, 0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, padding + Math.round(headerH * 0.82));
      ctx.lineTo(collageW - padding, padding + Math.round(headerH * 0.82));
      ctx.stroke();

      for (let idx = 0; idx < totalScreens; idx++) {
        const img = capturedScreenImages[idx];
        const r = Math.floor(idx / cols);
        const c = idx % cols;

        const cellX = padding + c * (cellWidth + gap);
        const cellY = padding + headerH + r * (cellHeight + gap);

        ctx.save();
        ctx.shadowColor = "rgba(15, 23, 42, 0.08)";
        ctx.shadowBlur = Math.round(cellWidth * 0.024);
        ctx.shadowOffsetY = Math.round(cellWidth * 0.008);
        ctx.fillStyle = "#ffffff";
        drawRoundedRect(ctx, cellX, cellY, cellWidth, cellHeight, cellRadius);
        ctx.fill();
        ctx.restore();

        ctx.save();
        drawRoundedRect(ctx, cellX, cellY, cellWidth, cellHeight, cellRadius);
        ctx.clip();
        ctx.drawImage(img, cellX, cellY, cellWidth, cellHeight);
        ctx.restore();

        const badgeNum = String(idx + 1).padStart(2, "0");
        const badgeH = Math.round(cellWidth * 0.034);
        const badgeW = Math.round(badgeH * 1.55);
        const badgeOffset = Math.round(cellWidth * 0.02);
        const badgeX = cellX + badgeOffset;
        const badgeY = cellY + badgeOffset;
        const badgeRadius = Math.round(badgeH * 0.22);

        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
        ctx.shadowBlur = Math.round(badgeH * 0.35);
        ctx.shadowOffsetY = Math.round(badgeH * 0.15);
        ctx.fillStyle = "#0f172a";
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeRadius);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.round(badgeH * 0.52)}px -apple-system, BlinkMacSystemFont, "SF Pro Display", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeNum, badgeX + badgeW / 2, badgeY + badgeH / 2);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }

      const footerY = collageH - padding;
      ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, footerY - Math.round(footerH * 0.45));
      ctx.lineTo(collageW - padding, footerY - Math.round(footerH * 0.45));
      ctx.stroke();

      ctx.fillStyle = "#94a3b8";
      ctx.font = `${Math.round(cellWidth * 0.011)}px -apple-system, sans-serif`;
      ctx.fillText(`CAIYI GRID ARCHIVE SYSTEM · RETINA FIDELITY COMPOSITION`, padding, footerY);

      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(15, 23, 42, 0.18)";
      ctx.font = `bold ${Math.round(cellWidth * 0.013)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.fillText(`CAIYI ARCHIVE // 采邑截图`, collageW - padding, footerY);
      ctx.textAlign = "start";

      toast.innerHTML = `<span>✓ 宫图生成完毕，开始下载...</span>`;
      await new Promise(r => setTimeout(r, 160));

      const finalDataUrl = canvas.toDataURL("image/png");
      const cleanFileName = pageTitle.replace(/[\\/:*?"<>|]/g, "_");
      safeDownloadFile(finalDataUrl, `${cleanFileName}_网页宫图.png`);
    } catch (err) {
      alert("生成宫图失败: " + err.message);
    } finally {
      scrollbarKiller.remove();
      floatingElements.forEach(f => f.el.style.visibility = f.origVisibility);
      window.scrollTo(origX, origY);
      docEl.style.scrollBehavior = origScrollBehavior;
      toolbar.style.display = "flex";
      if (toast && toast.parentNode) toast.remove();
    }
  }

  // ================= 12. 语义段落与批注映射关联 =================
  function extractArticleWithAnnotations() {
    const rawElements = Array.from(document.body.querySelectorAll("h1, h2, h3, h4, h5, h6, p, blockquote, li"))
      .filter(el => !el.closest("#cy-toolbar, #cy-launcher, #cy-annotations-layer") && el.innerText.trim().length > 0);

    const paragraphs = rawElements.map(el => {
      const rect = el.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      return {
        tag: el.tagName.toUpperCase(),
        text: el.innerText.trim(),
        top: rect.top + scrollTop,
        bottom: rect.bottom + scrollTop,
        element: el,
        annotations: []
      };
    });

    if (paragraphs.length === 0) {
      paragraphs.push({
        tag: "P",
        text: document.body.innerText.trim(),
        top: 0,
        bottom: 999999,
        element: document.body,
        annotations: []
      });
    }

    state.annotations.forEach(anno => {
      let matchedIndex = 0;
      let minDistance = Infinity;

      const targetNode = document.querySelector(`[data-cy-id="${anno.id}"]`);
      if (targetNode) {
        for (let i = 0; i < paragraphs.length; i++) {
          if (paragraphs[i].element.contains(targetNode)) {
            matchedIndex = i;
            minDistance = 0;
            break;
          }
        }
      }

      if (minDistance !== 0 && targetNode) {
        const targetRect = targetNode.getBoundingClientRect();
        for (let i = 0; i < paragraphs.length; i++) {
          const pRect = paragraphs[i].element.getBoundingClientRect();
          const dist = Math.abs(targetRect.top - pRect.top);
          if (dist < minDistance) {
            minDistance = dist;
            matchedIndex = i;
          }
        }
      }

      paragraphs[matchedIndex].annotations.push(anno);
    });

    return paragraphs;
  }

  // ================= 13. 文档导出 =================
  function exportDocument(format) {
    if (state.annotations.length === 0) {
      alert("当前没有批注内容可导出");
      return;
    }

    const title = document.title || "采邑批注与原文归档";
    const paragraphs = extractArticleWithAnnotations();
    const cleanFileName = title.replace(/[\\/:*?"<>|]/g, "_");

    if (format === "md") {
      let md = `# 《${title}》\n\n`;
      md += `> **来源**: ${window.location.href}\n`;
      md += `> **导出时间**: ${new Date().toLocaleString()} | **批注总数**: ${state.annotations.length} 条\n\n---\n\n`;

      paragraphs.forEach(p => {
        if (p.tag === "H1") md += `# ${p.text}\n\n`;
        else if (p.tag === "H2") md += `## ${p.text}\n\n`;
        else if (p.tag === "H3") md += `### ${p.text}\n\n`;
        else if (p.tag.startsWith("H")) md += `#### ${p.text}\n\n`;
        else if (p.tag === "LI") md += `* ${p.text}\n`;
        else if (p.tag === "BLOCKQUOTE") md += `> ${p.text}\n\n`;
        else md += `${p.text}\n\n`;

        if (p.annotations.length > 0) {
          p.annotations.forEach(anno => {
            md += `> 💬 **【采邑批注 · ${anno.type}】** (${anno.timestamp})\n`;
            if (anno.type === "涂色") {
              md += `> > 原文引文：“${anno.content}”\n`;
            } else if (anno.type === "截图" && anno.thumb) {
              md += `> ![截图](${anno.thumb})\n`;
            } else {
              md += `> 标注: ${anno.content}\n`;
            }
            if (anno.note) {
              md += `>\n> **批注笔记**: ${anno.note}\n`;
            }
            md += `\n`;
          });
        }
      });

      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      safeDownloadFile(URL.createObjectURL(blob), `${cleanFileName}.md`);
    } else if (format === "doc") {
      let docHtml = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>${title}</title>
        <style>
          body { font-family: -apple-system, SimSun, sans-serif; margin: 30px; color: #1e293b; }
          h1 { color: #0071e3; font-size: 22px; margin-bottom: 6px; }
          .meta { color: #64748b; font-size: 12px; margin-bottom: 24px; }
          table.row-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
          td.col-left { width: 68%; vertical-align: top; padding-right: 20px; font-size: 14px; line-height: 1.8; }
          td.col-right { width: 32%; vertical-align: top; border-left: 2px solid #2563eb; padding-left: 14px; background: #f8fafc; }
          .anno-box { padding: 6px 0; border-bottom: 1px dashed #cbd5e1; }
          .anno-box:last-child { border-bottom: none; }
          .anno-badge { font-size: 11px; font-weight: bold; color: #2563eb; }
          .anno-quote { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px; font-size: 12px; color: #475569; margin: 4px 0; }
          .anno-note { font-size: 12.5px; font-weight: bold; color: #0f172a; margin-top: 4px; }
          img { max-width: 100%; border-radius: 4px; display: block; margin: 4px 0; }
        </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div class="meta">
            <p>来源: ${window.location.href} | 导出时间: ${new Date().toLocaleString()} | 批注总计: ${state.annotations.length} 条</p>
          </div>
      `;

      paragraphs.forEach(p => {
        docHtml += `<table class="row-table"><tr>`;
        docHtml += `<td class="col-left">`;
        if (p.tag.startsWith("H")) docHtml += `<h3>${p.text}</h3>`;
        else docHtml += `<p>${p.text}</p>`;
        docHtml += `</td>`;

        docHtml += `<td class="col-right">`;
        if (p.annotations.length > 0) {
          p.annotations.forEach(anno => {
            docHtml += `<div class="anno-box">`;
            docHtml += `<div class="anno-badge">[${anno.type}] ${anno.timestamp}</div>`;
            if (anno.type === "涂色") {
              docHtml += `<div class="anno-quote">“${anno.content}”</div>`;
            } else if (anno.type === "截图" && anno.thumb) {
              docHtml += `<div><img src="${anno.thumb}" /></div>`;
            }
            if (anno.note) {
              docHtml += `<div class="anno-note">批注笔记: ${anno.note}</div>`;
            }
            docHtml += `</div>`;
          });
        }
        docHtml += `</td></tr></table>`;
      });

      docHtml += `</body></html>`;

      const blob = new Blob([docHtml], { type: "application/msword;charset=utf-8" });
      safeDownloadFile(URL.createObjectURL(blob), `${cleanFileName}.doc`);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDOM);
  } else {
    initDOM();
  }
})();