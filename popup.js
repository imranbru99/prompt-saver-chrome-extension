document.addEventListener("DOMContentLoaded", () => {
  const els = {
    toggleBtn: document.getElementById("toggle-form-btn"),
    inputContainer: document.getElementById("input-container"),
    saveBtn: document.getElementById("save-btn"),
    cancelBtn: document.getElementById("cancel-btn"),
    titleInput: document.getElementById("prompt-title"),
    tagsInput: document.getElementById("prompt-tags"),
    contentInput: document.getElementById("prompt-content"),
    editIdInput: document.getElementById("edit-id"),
    listContainer: document.getElementById("prompt-list"),
    search: document.getElementById("search"),
    count: document.getElementById("count"),
    toast: document.getElementById("toast")
  };

  let prompts = [];
  let query = "";

  function toast(msg, isError) {
    els.toast.hidden = false;
    els.toast.textContent = msg;
    els.toast.classList.toggle("error", !!isError);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { els.toast.hidden = true; }, 2200);
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }

  function parseTags(raw) {
    return String(raw || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  function resetForm() {
    els.titleInput.value = "";
    els.tagsInput.value = "";
    els.contentInput.value = "";
    els.editIdInput.value = "";
    els.inputContainer.classList.add("hidden");
    els.toggleBtn.classList.remove("hidden");
  }

  function filtered() {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((p) => {
      const hay = `${p.title} ${p.content} ${(p.tags || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function render() {
    const list = filtered();
    els.count.textContent = String(prompts.length);
    els.listContainer.innerHTML = "";
    if (!list.length) {
      els.listContainer.innerHTML = `<p class="empty-state">${prompts.length ? "No matches." : "No prompts yet. Click + New."}</p>`;
      return;
    }

    list.forEach((prompt) => {
      const div = document.createElement("div");
      div.className = "prompt-item";
      const tags = (prompt.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
      div.innerHTML = `
        <div class="prompt-text-group" title="Click to inject">
          <span class="prompt-title">${escapeHtml(prompt.title)}</span>
          <span class="prompt-preview">${escapeHtml(prompt.content)}</span>
          ${tags ? `<div class="tags">${tags}</div>` : ""}
        </div>
        <div class="actions">
          <button type="button" class="btn ghost edit-btn">Edit</button>
          <button type="button" class="btn danger delete-btn" aria-label="Delete">×</button>
        </div>
      `;
      div.querySelector(".prompt-text-group").onclick = () => injectPrompt(prompt.content);
      div.querySelector(".edit-btn").onclick = () => {
        els.editIdInput.value = prompt.id;
        els.titleInput.value = prompt.title;
        els.tagsInput.value = (prompt.tags || []).join(", ");
        els.contentInput.value = prompt.content;
        els.inputContainer.classList.remove("hidden");
        els.toggleBtn.classList.add("hidden");
      };
      div.querySelector(".delete-btn").onclick = () => deletePrompt(prompt.id);
      els.listContainer.appendChild(div);
    });
  }

  function loadPrompts() {
    chrome.storage.local.get(["prompts"], (result) => {
      prompts = Array.isArray(result.prompts) ? result.prompts : [];
      render();
    });
  }

  function savePrompts(next) {
    prompts = next;
    chrome.storage.local.set({ prompts }, render);
  }

  function deletePrompt(id) {
    savePrompts(prompts.filter((p) => String(p.id) !== String(id)));
    toast("Prompt deleted");
  }

  async function injectPrompt(text) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab");
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (textToPaste) => {
          const selectors = [
            "div[contenteditable='true']",
            "textarea#prompt-textarea",
            "textarea[data-id='root']",
            "textarea",
            "[role='textbox']"
          ];
          let editor = null;
          for (const sel of selectors) {
            const nodes = Array.from(document.querySelectorAll(sel));
            editor = nodes.reverse().find((n) => {
              const r = n.getBoundingClientRect();
              return r.width > 40 && r.height > 20 && !n.disabled && !n.readOnly;
            });
            if (editor) break;
          }
          if (!editor) return false;
          editor.focus();
          if (editor.isContentEditable) {
            document.execCommand("selectAll", false, null);
            document.execCommand("insertText", false, textToPaste);
            editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: textToPaste }));
          } else {
            const proto = editor.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (setter) setter.call(editor, textToPaste);
            else editor.value = textToPaste;
            editor.dispatchEvent(new Event("input", { bubbles: true }));
            editor.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return true;
        },
        args: [text]
      });
      if (result) toast("Injected into page editor");
      else toast("No editor found on this page", true);
    } catch (err) {
      toast(err.message || String(err), true);
    }
  }

  els.toggleBtn.addEventListener("click", () => {
    resetForm();
    els.inputContainer.classList.remove("hidden");
    els.toggleBtn.classList.add("hidden");
    els.titleInput.focus();
  });

  els.cancelBtn.addEventListener("click", resetForm);

  els.saveBtn.addEventListener("click", () => {
    const title = els.titleInput.value.trim();
    const content = els.contentInput.value.trim();
    const tags = parseTags(els.tagsInput.value);
    const editId = els.editIdInput.value;
    if (!content) {
      toast("Enter prompt content", true);
      return;
    }
    if (editId) {
      savePrompts(prompts.map((p) => String(p.id) === String(editId)
        ? { ...p, title: title || "Untitled", content, tags }
        : p));
      toast("Prompt updated");
    } else {
      savePrompts([
        ...prompts,
        {
          id: Date.now(),
          title: title || content.slice(0, 28),
          content,
          tags,
          createdAt: new Date().toISOString()
        }
      ]);
      toast("Prompt saved");
    }
    resetForm();
  });

  els.search.addEventListener("input", (e) => {
    query = e.target.value;
    render();
  });

  loadPrompts();
});
