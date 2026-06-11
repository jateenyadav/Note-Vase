/* ==========================================================================
   Note Vase — App engine
   Pure vanilla JS. No frameworks. localStorage persistence.
   Features: titles, content, tags, colors, pin, archive, trash, search,
   sort, grid/list views, markdown preview, dark mode, export/import,
   keyboard shortcuts, undo, autosave drafts, toasts.
   ========================================================================== */
"use strict";

(() => {
    /* ------------------------- Constants & State ------------------------- */
    const STORAGE_KEY = "noteVase.notes.v2";
    const SETTINGS_KEY = "noteVase.settings.v2";
    const DRAFT_KEY = "noteVase.draft.v2";
    const LEGACY_KEY = "notes"; // migrate from old version

    const DEFAULT_SETTINGS = {
        theme: "dark",
        view: "grid",     // grid | list
        sort: "updated",  // updated | created | alpha
        filter: "all",    // all | pinned | archived | trash
        activeTag: null
    };

    /** @type {Note[]} */
    let notes = [];
    let settings = { ...DEFAULT_SETTINGS };
    let editing = null; // currently open note (full object) or null
    let confirmResolver = null;

    /** Note shape:
     * { id, title, content, tags[], color, pinned, archived, trashed,
     *   createdAt, updatedAt }
     */

    /* ------------------------- Helpers ------------------------- */
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    const uid = () =>
        "n_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);

    const escapeHtml = (str = "") =>
        String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

    const formatDate = (ts) => {
        if (!ts) return "";
        const d = new Date(ts);
        const now = new Date();
        const diff = (now - d) / 1000;
        if (diff < 60) return "just now";
        if (diff < 3600) return Math.floor(diff / 60) + "m ago";
        if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
        if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    };

    const wordCount = (s = "") => (s.trim() ? s.trim().split(/\s+/).length : 0);

    const debounce = (fn, ms = 250) => {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    };

    /* ------------------------- Persistence ------------------------- */
    const loadNotes = () => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { console.warn("loadNotes failed", e); }
        // migrate legacy: array of plain strings
        try {
            const legacy = localStorage.getItem(LEGACY_KEY);
            if (legacy) {
                const arr = JSON.parse(legacy);
                if (Array.isArray(arr)) {
                    return arr.map((text) => ({
                        id: uid(),
                        title: (typeof text === "string" ? text.split("\n")[0] : "").slice(0, 80) || "Untitled",
                        content: typeof text === "string" ? text : "",
                        tags: [], color: "default",
                        pinned: false, archived: false, trashed: false,
                        createdAt: Date.now(), updatedAt: Date.now()
                    }));
                }
            }
        } catch (e) { /* ignore */ }
        return [];
    };

    const saveNotes = () => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }
        catch (e) { toast("Could not save (storage full?)", "error"); }
    };

    const loadSettings = () => {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        } catch (e) { /* ignore */ }
        return { ...DEFAULT_SETTINGS };
    };

    const saveSettings = () => {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
        catch (e) { /* ignore */ }
    };

    /* ------------------------- Toast ------------------------- */
    let toastTimer = null;
    const toast = (msg, type = "info") => {
        const el = $("#toast");
        if (!el) return;
        el.className = "toast show is-" + type;
        el.textContent = msg;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.classList.remove("show");
            setTimeout(() => el.classList.add("hidden"), 200);
        }, 2400);
        el.classList.remove("hidden");
    };

    /* ------------------------- Confirm modal ------------------------- */
    const confirmAction = (titleOrOpts, message) => new Promise((resolve) => {
        let title = titleOrOpts;
        let body = message;
        if (titleOrOpts && typeof titleOrOpts === "object") {
            title = titleOrOpts.title;
            body = titleOrOpts.body || titleOrOpts.message || "";
        }
        $("#confirmTitle").textContent = title || "Are you sure?";
        $("#confirmMessage").textContent = body || "";
        $("#confirmOverlay").classList.remove("hidden");
        confirmResolver = resolve;
    });
    const closeConfirm = (val) => {
        $("#confirmOverlay").classList.add("hidden");
        if (confirmResolver) { confirmResolver(val); confirmResolver = null; }
    };

    /* ------------------------- Markdown (mini) ------------------------- */
    // Lightweight, safe-ish markdown. Escapes HTML first, then transforms.
    const mdToHtml = (src = "") => {
        let s = escapeHtml(src);

        // Code blocks ```...```
        s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.replace(/\n$/, "")}</code></pre>`);

        // Headings
        s = s.replace(/^######\s?(.*)$/gm, "<h6>$1</h6>")
             .replace(/^#####\s?(.*)$/gm, "<h5>$1</h5>")
             .replace(/^####\s?(.*)$/gm, "<h4>$1</h4>")
             .replace(/^###\s?(.*)$/gm, "<h3>$1</h3>")
             .replace(/^##\s?(.*)$/gm, "<h2>$1</h2>")
             .replace(/^#\s?(.*)$/gm, "<h1>$1</h1>");

        // Blockquote
        s = s.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");

        // Task lists
        s = s.replace(/^\s*[-*]\s\[ \]\s+(.*)$/gm, '<li class="task"><input type="checkbox" disabled> $1</li>')
             .replace(/^\s*[-*]\s\[x\]\s+(.*)$/gim, '<li class="task done"><input type="checkbox" disabled checked> $1</li>');

        // Unordered lists
        s = s.replace(/(?:^|\n)((?:\s*[-*]\s.+\n?)+)/g, (block) => {
            const items = block.trim().split(/\n/).map((l) => l.replace(/^\s*[-*]\s/, "").trim());
            if (items.some((i) => /^<li class="task/.test(i))) return "\n" + block; // skip; tasks already li
            return "\n<ul>" + items.map((i) => `<li>${i}</li>`).join("") + "</ul>";
        });

        // Ordered lists
        s = s.replace(/(?:^|\n)((?:\s*\d+\.\s.+\n?)+)/g, (block) => {
            const items = block.trim().split(/\n/).map((l) => l.replace(/^\s*\d+\.\s/, "").trim());
            return "\n<ol>" + items.map((i) => `<li>${i}</li>`).join("") + "</ol>";
        });

        // Inline: bold, italic, strike, code, link
        s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
             .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
             .replace(/~~([^~]+)~~/g, "<del>$1</del>")
             .replace(/`([^`]+)`/g, "<code>$1</code>")
             .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // Auto-link bare URLs
        s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

        // Paragraphs from blank-line separated chunks (skip if already block-level)
        s = s.split(/\n{2,}/).map((chunk) => {
            if (/^\s*<(h\d|ul|ol|pre|blockquote|p|div|table)/i.test(chunk.trim())) return chunk;
            return chunk.trim() ? `<p>${chunk.replace(/\n/g, "<br>")}</p>` : "";
        }).join("\n");

        return s;
    };

    /* ------------------------- Filtering / sorting ------------------------- */
    const getFiltered = () => {
        const q = ($("#searchInput").value || "").trim().toLowerCase();
        let arr = notes.slice();

        switch (settings.filter) {
            case "pinned":   arr = arr.filter(n => !n.trashed && !n.archived && n.pinned); break;
            case "archived": arr = arr.filter(n => !n.trashed && n.archived); break;
            case "trash":    arr = arr.filter(n => n.trashed); break;
            default:         arr = arr.filter(n => !n.trashed && !n.archived);
        }

        if (settings.activeTag) {
            arr = arr.filter(n => n.tags && n.tags.includes(settings.activeTag));
        }

        if (q) {
            // Support "#tag" search
            if (q.startsWith("#")) {
                const tag = q.slice(1);
                arr = arr.filter(n => (n.tags || []).some(t => t.toLowerCase().includes(tag)));
            } else {
                arr = arr.filter(n =>
                    (n.title || "").toLowerCase().includes(q) ||
                    (n.content || "").toLowerCase().includes(q) ||
                    (n.tags || []).some(t => t.toLowerCase().includes(q))
                );
            }
        }

        switch (settings.sort) {
            case "created": arr.sort((a, b) => b.createdAt - a.createdAt); break;
            case "alpha":   arr.sort((a, b) => (a.title || "").localeCompare(b.title || "")); break;
            default:        arr.sort((a, b) => b.updatedAt - a.updatedAt);
        }
        // Pinned first (only in non-trash, non-archived primary list)
        if (settings.filter === "all") {
            arr.sort((a, b) => Number(b.pinned) - Number(a.pinned));
        }
        return arr;
    };

    /* ------------------------- Rendering ------------------------- */
    const render = () => {
        renderNotes();
        renderTags();
        renderCounts();
        renderStats();
        renderViewTitle();
    };

    const renderViewTitle = () => {
        const map = { all: "All notes", pinned: "Pinned", archived: "Archived", trash: "Trash" };
        let t = map[settings.filter] || "Notes";
        if (settings.activeTag) t += ` · #${settings.activeTag}`;
        $("#viewTitle").textContent = t;
        const empty = $("#emptyTrashBtn");
        if (empty) {
            const trashed = notes.filter(n => n.trashed).length;
            empty.classList.toggle("hidden", !(settings.filter === "trash" && trashed > 0));
        }
    };

    const renderCounts = () => {
        const live = notes.filter(n => !n.trashed);
        $("#countAll").textContent = live.filter(n => !n.archived).length;
        $("#countPinned").textContent = live.filter(n => n.pinned && !n.archived).length;
        $("#countArchived").textContent = live.filter(n => n.archived).length;
        $("#countTrash").textContent = notes.filter(n => n.trashed).length;
    };

    const renderStats = () => {
        const live = notes.filter(n => !n.trashed);
        $("#statTotal").textContent = live.length;
        const words = live.reduce((sum, n) => sum + wordCount(n.content) + wordCount(n.title), 0);
        $("#statWords").textContent = words.toLocaleString();
        try {
            const bytes = new Blob([localStorage.getItem(STORAGE_KEY) || ""]).size;
            $("#statStorage").textContent = (bytes / 1024).toFixed(1) + " KB";
        } catch (e) { $("#statStorage").textContent = "—"; }
    };

    const renderTags = () => {
        const wrap = $("#tagsList");
        const counts = {};
        notes.forEach(n => {
            if (n.trashed) return;
            (n.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
        });
        const tags = Object.keys(counts).sort();
        if (!tags.length) {
            wrap.innerHTML = '<span class="muted small">No tags yet</span>';
            return;
        }
        wrap.innerHTML = tags.map(t => {
            const active = settings.activeTag === t ? " is-active" : "";
            return `<button class="tag-chip${active}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)} <span class="count">${counts[t]}</span></button>`;
        }).join("");
    };

    const renderNotes = () => {
        const grid = $("#notesGrid");
        const empty = $("#emptyState");
        const list = getFiltered();

        grid.classList.toggle("is-list", settings.view === "list");

        if (!list.length) {
            grid.innerHTML = "";
            empty.classList.remove("hidden");
            return;
        }
        empty.classList.add("hidden");

        grid.innerHTML = list.map(n => {
            const rawContent = (n.content || "");
            const truncated = rawContent.length > 320 ? rawContent.slice(0, 320) + "…" : rawContent;
            const bodyHtml = rawContent ? mdToHtml(truncated) : '<span class="muted small">Empty note</span>';
            const tagsHtml = (n.tags || []).slice(0, 4).map(t =>
                `<span class="note-card-tag">#${escapeHtml(t)}</span>`).join("");
            const pinned = n.pinned ? "is-pinned" : "";
            const trashed = n.trashed ? "is-trashed" : "";
            const color = escapeHtml(n.color || "default");
            const pinIndicator = n.pinned && !n.trashed ? `
                <span class="note-card-pin" title="Pinned" aria-label="Pinned">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M14 4l6 6-3 1-4 4-1 5-2-2-4 4-1-1 4-4-2-2 5-1 4-4 1-3 -3z" transform="rotate(-15 12 12)"/></svg>
                </span>` : "";
            return `
                <article class="note-card ${pinned} ${trashed}" data-id="${n.id}" data-color="${color}" tabindex="0">
                    <header class="note-card-head">
                        <h3 class="note-card-title">${escapeHtml(n.title || "Untitled")}</h3>
                        ${pinIndicator}
                        <div class="note-card-actions">
                            ${n.trashed ? `
                                <button class="icon-btn" data-act="restore" title="Restore" aria-label="Restore">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                                </button>
                                <button class="icon-btn" data-act="purge" title="Delete forever" aria-label="Delete forever">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                                </button>
                            ` : `
                                <button class="icon-btn" data-act="pin" title="${n.pinned ? "Unpin" : "Pin"}" aria-label="${n.pinned ? "Unpin" : "Pin"}">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="${n.pinned ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.4-2.8a4 4 0 0 1-.6-2.1V8a5 5 0 0 0-10 0v4.1a4 4 0 0 1-.6 2.1L5 17z"/></svg>
                                </button>
                                <button class="icon-btn" data-act="archive" title="${n.archived ? "Unarchive" : "Archive"}" aria-label="${n.archived ? "Unarchive" : "Archive"}">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                                </button>
                                <button class="icon-btn" data-act="trash" title="Move to trash" aria-label="Trash">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
                                </button>
                            `}
                        </div>
                    </header>
                    <div class="note-card-body">${bodyHtml}</div>
                    <footer class="note-card-foot">
                        <div class="note-card-tags">${tagsHtml}</div>
                        <span class="note-card-date" title="${new Date(n.updatedAt).toLocaleString()}">${formatDate(n.updatedAt)}</span>
                    </footer>
                </article>
            `;
        }).join("");
    };

    /* ------------------------- CRUD ------------------------- */
    const findNote = (id) => notes.find(n => n.id === id);

    const createNote = (seed = {}) => {
        const now = Date.now();
        const note = {
            id: uid(),
            title: seed.title || "",
            content: seed.content || "",
            tags: seed.tags || [],
            color: seed.color || "default",
            pinned: false,
            archived: false,
            trashed: false,
            createdAt: now,
            updatedAt: now
        };
        notes.unshift(note);
        saveNotes();
        return note;
    };

    const updateNote = (id, patch) => {
        const n = findNote(id);
        if (!n) return;
        Object.assign(n, patch, { updatedAt: Date.now() });
        saveNotes();
    };

    const togglePin = (id) => {
        const n = findNote(id);
        if (!n) return;
        n.pinned = !n.pinned;
        n.updatedAt = Date.now();
        saveNotes();
        render();
        toast(n.pinned ? "Pinned" : "Unpinned");
    };

    const toggleArchive = (id) => {
        const n = findNote(id);
        if (!n) return;
        n.archived = !n.archived;
        if (n.archived) n.pinned = false;
        n.updatedAt = Date.now();
        saveNotes();
        render();
        toast(n.archived ? "Archived" : "Unarchived");
    };

    const trashNote = (id) => {
        const n = findNote(id);
        if (!n) return;
        n.trashed = true;
        n.pinned = false;
        n.updatedAt = Date.now();
        saveNotes();
        render();
        toast("Moved to trash");
    };

    const restoreNote = (id) => {
        const n = findNote(id);
        if (!n) return;
        n.trashed = false;
        n.archived = false;
        n.updatedAt = Date.now();
        saveNotes();
        render();
        toast("Restored");
    };

    const purgeNote = async (id) => {
        const ok = await confirmAction({
            title: "Delete note forever?",
            body: "This cannot be undone."
        });
        if (!ok) return;
        notes = notes.filter(n => n.id !== id);
        saveNotes();
        render();
        toast("Deleted permanently");
    };

    const emptyTrash = async () => {
        const trashCount = notes.filter(n => n.trashed).length;
        if (!trashCount) { toast("Trash is already empty"); return; }
        const ok = await confirmAction({
            title: `Empty trash (${trashCount} note${trashCount === 1 ? "" : "s"})?`,
            body: "All trashed notes will be permanently deleted."
        });
        if (!ok) return;
        notes = notes.filter(n => !n.trashed);
        saveNotes();
        render();
        toast("Trash emptied");
    };

    /* ------------------------- Editor ------------------------- */
    const openEditor = (note = null) => {
        editing = note ? { ...note, tags: [...(note.tags || [])] } : {
            id: null,
            title: "",
            content: "",
            tags: [],
            color: "default",
            pinned: false,
            archived: false,
            trashed: false
        };
        $("#noteTitle").value = editing.title || "";
        $("#noteContent").value = editing.content || "";
        $("#noteTags").value = (editing.tags || []).map(t => "#" + t).join(", ");
        renderEditorColors();
        renderPinState();
        updateEditorMeta();
        // Reset preview toggle
        $("#noteContent").classList.remove("hidden");
        $("#notePreview").classList.add("hidden");
        const prevBtn = $("#togglePreview");
        if (prevBtn) {
            prevBtn.setAttribute("aria-pressed", "false");
            prevBtn.classList.remove("is-active");
        }
        const overlay = $("#editorOverlay");
        overlay.classList.remove("hidden");
        overlay.setAttribute("aria-hidden", "false");
        setTimeout(() => $("#noteTitle").focus(), 50);
    };

    const closeEditor = (save = true) => {
        if (save) commitEditor();
        const overlay = $("#editorOverlay");
        overlay.classList.add("hidden");
        overlay.setAttribute("aria-hidden", "true");
        editing = null;
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    };

    const parseTagsInput = (raw) => {
        if (!raw) return [];
        return raw
            .split(/[,\n]/)
            .map(t => t.trim().replace(/^#/, "").toLowerCase())
            .filter(t => /^[a-z0-9_\-]{1,24}$/i.test(t))
            .filter((t, i, a) => a.indexOf(t) === i)
            .slice(0, 20);
    };

    const commitEditor = () => {
        if (!editing) return;
        const title = $("#noteTitle").value.trim();
        const content = $("#noteContent").value;
        const tags = parseTagsInput($("#noteTags").value);
        editing.tags = tags;
        const hasContent = title || content.trim() || (tags && tags.length);

        if (editing.id) {
            updateNote(editing.id, {
                title,
                content,
                tags,
                color: editing.color,
                pinned: !!editing.pinned
            });
            toast("Saved", "success");
        } else if (hasContent) {
            const created = createNote({
                title,
                content,
                tags,
                color: editing.color
            });
            if (editing.pinned && created) {
                updateNote(created.id, { pinned: true });
            }
            toast("Note created", "success");
        }
        render();
    };

    const renderPinState = () => {
        const btn = $("#pinBtn");
        if (!btn) return;
        const on = !!(editing && editing.pinned);
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.title = on ? "Unpin (P)" : "Pin (P)";
    };

    const renderEditorColors = () => {
        // The HTML has fixed color swatches in .color-swatches; just toggle is-active
        const wrap = $(".modal-tools .color-swatches");
        if (!wrap || !editing) return;
        $$(".swatch", wrap).forEach(sw => {
            sw.classList.toggle("is-active", sw.dataset.color === (editing.color || "default"));
        });
    };

    const updateEditorMeta = () => {
        const content = $("#noteContent").value;
        const title = $("#noteTitle").value;
        const wc = wordCount(title) + wordCount(content);
        const cc = (title + content).length;
        const meta = $("#noteStats");
        if (meta) meta.textContent = `${wc} word${wc === 1 ? "" : "s"} · ${cc} character${cc === 1 ? "" : "s"}`;
    };

    const togglePreview = () => {
        const ta = $("#noteContent");
        const pv = $("#notePreview");
        const btn = $("#togglePreview");
        const isPreview = !pv.classList.contains("hidden");
        if (isPreview) {
            pv.classList.add("hidden");
            ta.classList.remove("hidden");
            btn?.setAttribute("aria-pressed", "false");
            btn?.classList.remove("is-active");
            ta.focus();
        } else {
            pv.innerHTML = mdToHtml(ta.value || "");
            ta.classList.add("hidden");
            pv.classList.remove("hidden");
            btn?.setAttribute("aria-pressed", "true");
            btn?.classList.add("is-active");
        }
    };

    /* Markdown toolbar — insert/wrap selection in #noteContent */
    const applyMd = (kind) => {
        const ta = $("#noteContent");
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        const sel = val.slice(start, end);
        const wrap = (l, r = l) => {
            const text = sel || "text";
            const out = l + text + r;
            ta.value = val.slice(0, start) + out + val.slice(end);
            const cursor = start + l.length + text.length;
            ta.focus();
            ta.setSelectionRange(start + l.length, cursor);
        };
        const linePrefix = (prefix) => {
            const lineStart = val.lastIndexOf("\n", start - 1) + 1;
            const before = val.slice(0, lineStart);
            const rest = val.slice(lineStart);
            ta.value = before + prefix + rest;
            const pos = start + prefix.length;
            ta.focus();
            ta.setSelectionRange(pos, end + prefix.length);
        };
        switch (kind) {
            case "bold":   return wrap("**");
            case "italic": return wrap("*");
            case "strike": return wrap("~~");
            case "code":   return wrap("`");
            case "link": {
                const text = sel || "link";
                const out = `[${text}](https://)`;
                ta.value = val.slice(0, start) + out + val.slice(end);
                ta.focus();
                ta.setSelectionRange(start + out.length - 9, start + out.length - 1);
                return;
            }
            case "h1":    return linePrefix("# ");
            case "h2":    return linePrefix("## ");
            case "quote": return linePrefix("> ");
            case "ul":    return linePrefix("- ");
            case "ol":    return linePrefix("1. ");
            case "task":  return linePrefix("- [ ] ");
        }
        updateEditorMeta();
    };

    /* ------------------------- Import / Export ------------------------- */
    const exportNotes = () => {
        const payload = {
            app: "Note Vase",
            version: 2,
            exportedAt: new Date().toISOString(),
            notes
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        a.href = url;
        a.download = `note-vase-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast("Exported");
    };

    const importNotes = async (file) => {
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const incoming = Array.isArray(data) ? data : Array.isArray(data.notes) ? data.notes : null;
            if (!incoming) { toast("Invalid file"); return; }
            const ok = await confirmAction({
                title: `Import ${incoming.length} note${incoming.length === 1 ? "" : "s"}?`,
                body: "Existing notes will be kept. Duplicates by ID are skipped."
            });
            if (!ok) return;
            const known = new Set(notes.map(n => n.id));
            let added = 0;
            incoming.forEach(raw => {
                if (!raw || typeof raw !== "object") return;
                const id = raw.id && !known.has(raw.id) ? raw.id : uid();
                if (known.has(id)) return;
                known.add(id);
                const now = Date.now();
                notes.push({
                    id,
                    title: String(raw.title || "").slice(0, 500),
                    content: String(raw.content || ""),
                    tags: Array.isArray(raw.tags) ? raw.tags.filter(t => typeof t === "string").slice(0, 20) : [],
                    color: typeof raw.color === "string" ? raw.color : "default",
                    pinned: Boolean(raw.pinned),
                    archived: Boolean(raw.archived),
                    trashed: Boolean(raw.trashed),
                    createdAt: Number(raw.createdAt) || now,
                    updatedAt: Number(raw.updatedAt) || now
                });
                added++;
            });
            saveNotes();
            render();
            toast(`Imported ${added} note${added === 1 ? "" : "s"}`);
        } catch (e) {
            console.error(e);
            toast("Failed to import");
        }
    };

    /* ------------------------- Theme & Settings ------------------------- */
    const applyTheme = () => {
        const t = settings.theme;
        const root = document.documentElement;
        if (t === "system") {
            const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            root.dataset.theme = dark ? "dark" : "light";
        } else {
            root.dataset.theme = t;
        }
        const btn = $("#themeToggle");
        if (btn) btn.setAttribute("aria-pressed", root.dataset.theme === "dark" ? "true" : "false");
    };

    const cycleTheme = () => {
        const order = ["light", "dark", "system"];
        const i = order.indexOf(settings.theme);
        settings.theme = order[(i + 1) % order.length];
        saveSettings();
        applyTheme();
        toast(`Theme: ${settings.theme}`);
    };

    const setView = (v) => {
        settings.view = v === "list" ? "list" : "grid";
        saveSettings();
        const grid = $("#viewGrid");
        const list = $("#viewList");
        if (grid) {
            grid.classList.toggle("is-active", settings.view === "grid");
            grid.setAttribute("aria-pressed", settings.view === "grid" ? "true" : "false");
        }
        if (list) {
            list.classList.toggle("is-active", settings.view === "list");
            list.setAttribute("aria-pressed", settings.view === "list" ? "true" : "false");
        }
        const wrap = $("#notesGrid");
        if (wrap) {
            wrap.classList.add("notes-grid");
            wrap.classList.toggle("list-view", settings.view === "list");
        }
        render();
    };

    const setFilter = (f) => {
        settings.filter = f;
        settings.activeTag = "";
        saveSettings();
        $$(".filter-btn").forEach(b => {
            b.classList.toggle("is-active", b.dataset.filter === f);
            b.setAttribute("aria-pressed", b.dataset.filter === f ? "true" : "false");
        });
        render();
    };

    const setSort = (s) => {
        settings.sort = s;
        saveSettings();
        $$(".seg-btn[data-sort]").forEach(b => {
            b.classList.toggle("is-active", b.dataset.sort === s);
            b.setAttribute("aria-pressed", b.dataset.sort === s ? "true" : "false");
        });
        render();
    };

    /* ------------------------- Keyboard shortcuts ------------------------- */
    const onKey = (e) => {
        const inEditor = !$("#editorOverlay").classList.contains("hidden");
        const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");

        // Escape closes overlays
        if (e.key === "Escape") {
            if (inEditor) { e.preventDefault(); closeEditor(true); return; }
            if (!$("#confirmOverlay").classList.contains("hidden")) { e.preventDefault(); closeConfirm(false); return; }
            if (!$("#helpOverlay").classList.contains("hidden")) { e.preventDefault(); $("#helpOverlay").classList.add("hidden"); return; }
        }

        // Ctrl/Cmd + S — save (in editor)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            if (inEditor) { e.preventDefault(); commitEditor(); toast("Saved"); }
            return;
        }

        // Ctrl/Cmd + Enter — save & close editor
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            if (inEditor) { e.preventDefault(); closeEditor(true); }
            return;
        }

        // In-editor formatting shortcuts
        if (inEditor && (e.ctrlKey || e.metaKey)) {
            const k = e.key.toLowerCase();
            if (k === "b") { e.preventDefault(); applyMd("bold"); return; }
            if (k === "i") { e.preventDefault(); applyMd("italic"); return; }
            if (k === "e") { e.preventDefault(); togglePreview(); return; }
            if (k === "k") { e.preventDefault(); applyMd("link"); return; }
        }

        // P inside editor toggles pin (when not typing in title/content/tags)
        if (inEditor && e.key.toLowerCase() === "p" && !inField && editing) {
            e.preventDefault();
            editing.pinned = !editing.pinned;
            renderPinState();
            return;
        }

        if (inField || inEditor) return;

        // n — new note
        if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            openEditor();
            return;
        }
        // / — focus search
        if (e.key === "/") {
            e.preventDefault();
            $("#searchInput").focus();
            return;
        }
        // ? — help
        if (e.key === "?") {
            e.preventDefault();
            $("#helpOverlay").classList.remove("hidden");
            return;
        }
        // g then p/a/t/h — quick filter
        if (e.key === "g") {
            window.__gPending = true;
            setTimeout(() => { window.__gPending = false; }, 800);
            return;
        }
        if (window.__gPending) {
            window.__gPending = false;
            const map = { h: "all", p: "pinned", a: "archived", t: "trash" };
            if (map[e.key]) { e.preventDefault(); setFilter(map[e.key]); }
        }
    };

    /* ------------------------- Event wiring ------------------------- */
    const wire = () => {
        // Topbar
        $("#newNoteBtn")?.addEventListener("click", () => openEditor());
        $("#themeToggle")?.addEventListener("click", cycleTheme);
        $("#helpBtn")?.addEventListener("click", () => $("#helpOverlay").classList.remove("hidden"));
        $("#exportBtn")?.addEventListener("click", exportNotes);
        $("#importBtn")?.addEventListener("click", () => $("#importFile").click());
        $("#importFile")?.addEventListener("change", (e) => {
            const f = e.target.files && e.target.files[0];
            importNotes(f);
            e.target.value = "";
        });

        // Search
        const onSearch = debounce(() => render(), 120);
        $("#searchInput")?.addEventListener("input", onSearch);
        $("#searchInput")?.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { e.target.value = ""; render(); e.target.blur(); }
        });

        // Sidebar nav
        $$(".filter-btn").forEach(btn => {
            btn.addEventListener("click", () => setFilter(btn.dataset.filter));
        });

        // Tags list (delegated)
        $("#tagsList")?.addEventListener("click", (e) => {
            const chip = e.target.closest(".tag-chip");
            if (!chip) return;
            const t = chip.dataset.tag;
            settings.activeTag = settings.activeTag === t ? "" : t;
            saveSettings();
            render();
        });

        // Empty trash
        $("#emptyTrashBtn")?.addEventListener("click", emptyTrash);

        // View / sort
        $("#viewGrid")?.addEventListener("click", () => setView("grid"));
        $("#viewList")?.addEventListener("click", () => setView("list"));
        $$(".seg-btn[data-sort]").forEach(b => {
            b.addEventListener("click", () => setSort(b.dataset.sort));
        });

        // Notes grid (delegated)
        $("#notesGrid")?.addEventListener("click", (e) => {
            const btn = e.target.closest(".note-card-actions .icon-btn, [data-act]");
            const card = e.target.closest(".note-card");
            if (!card) return;
            const id = card.dataset.id;
            if (btn) {
                e.stopPropagation();
                const act = btn.dataset.act;
                if (act === "pin")     return togglePin(id);
                if (act === "archive") return toggleArchive(id);
                if (act === "trash")   return trashNote(id);
                if (act === "restore") return restoreNote(id);
                if (act === "purge")   return purgeNote(id);
            }
            const n = findNote(id);
            if (n && !n.trashed) openEditor(n);
            else if (n && n.trashed) toast("Restore note to edit");
        });

        // Editor
        $("#closeEditor")?.addEventListener("click", () => closeEditor(true));
        $("#saveBtn")?.addEventListener("click", () => closeEditor(true));
        $("#deleteBtn")?.addEventListener("click", async () => {
            if (!editing) return closeEditor(false);
            if (!editing.id) {
                // Unsaved new note — just close without saving
                editing = null;
                $("#editorOverlay").classList.add("hidden");
                $("#editorOverlay").setAttribute("aria-hidden", "true");
                try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
                return;
            }
            const ok = await confirmAction("Move to Trash?", "You can restore it from the Trash filter.");
            if (!ok) return;
            const id = editing.id;
            // Close without committing pending edits to a soon-to-be-trashed note
            editing = null;
            $("#editorOverlay").classList.add("hidden");
            $("#editorOverlay").setAttribute("aria-hidden", "true");
            try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
            trashNote(id);
        });
        $("#togglePreview")?.addEventListener("click", togglePreview);
        $("#noteTitle")?.addEventListener("input", updateEditorMeta);
        $("#noteContent")?.addEventListener("input", debounce(() => {
            updateEditorMeta();
            try {
                if (editing) {
                    localStorage.setItem(DRAFT_KEY, JSON.stringify({
                        title: $("#noteTitle").value,
                        content: $("#noteContent").value,
                        tags: parseTagsInput($("#noteTags").value),
                        color: editing.color,
                        ts: Date.now()
                    }));
                }
            } catch (e) { /* ignore */ }
        }, 200));

        // Editor: pin button
        $("#pinBtn")?.addEventListener("click", () => {
            if (!editing) return;
            editing.pinned = !editing.pinned;
            renderPinState();
        });

        // Editor: color swatches (inside .modal-tools .color-swatches)
        $(".modal-tools .color-swatches")?.addEventListener("click", (e) => {
            const sw = e.target.closest(".swatch");
            if (!sw || !editing) return;
            editing.color = sw.dataset.color || "default";
            renderEditorColors();
        });

        // Editor: markdown toolbar
        $(".editor-toolbar")?.addEventListener("click", (e) => {
            const btn = e.target.closest(".tb-btn");
            if (!btn) return;
            if (btn.id === "togglePreview") return; // handled separately
            const kind = btn.dataset.md;
            if (kind) applyMd(kind);
        });

        // Confirm modal
        $("#confirmOk")?.addEventListener("click", () => closeConfirm(true));
        $("#confirmCancel")?.addEventListener("click", () => closeConfirm(false));
        $("#confirmOverlay")?.addEventListener("click", (e) => {
            if (e.target.id === "confirmOverlay") closeConfirm(false);
        });

        // Help modal
        $("#closeHelp")?.addEventListener("click", () => $("#helpOverlay").classList.add("hidden"));
        $("#helpOverlay")?.addEventListener("click", (e) => {
            if (e.target.id === "helpOverlay") $("#helpOverlay").classList.add("hidden");
        });

        // Editor overlay click outside
        $("#editorOverlay")?.addEventListener("click", (e) => {
            if (e.target.id === "editorOverlay") closeEditor(true);
        });

        // System theme changes
        if (window.matchMedia) {
            window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
                if (settings.theme === "system") applyTheme();
            });
        }

        // Global keys
        document.addEventListener("keydown", onKey);

        // Save current sort/view UI state
        $$(".seg-btn[data-sort]").forEach(b => {
            b.classList.toggle("is-active", b.dataset.sort === settings.sort);
            b.setAttribute("aria-pressed", b.dataset.sort === settings.sort ? "true" : "false");
        });
        $("#viewGrid")?.classList.toggle("is-active", settings.view === "grid");
        $("#viewGrid")?.setAttribute("aria-pressed", settings.view === "grid" ? "true" : "false");
        $("#viewList")?.classList.toggle("is-active", settings.view === "list");
        $("#viewList")?.setAttribute("aria-pressed", settings.view === "list" ? "true" : "false");
        const wrap = $("#notesGrid");
        if (wrap) {
            wrap.classList.add("notes-grid");
            wrap.classList.toggle("list-view", settings.view === "list");
        }
        $$(".filter-btn").forEach(b => {
            b.classList.toggle("is-active", b.dataset.filter === settings.filter);
            b.setAttribute("aria-pressed", b.dataset.filter === settings.filter ? "true" : "false");
        });
    };

    /* ------------------------- Boot ------------------------- */
    const boot = () => {
        notes = loadNotes();
        settings = loadSettings();
        applyTheme();
        wire();
        render();

        // Track actual topbar height so sticky sidebar/main offsets stay correct
        const updateTopbarVar = () => {
            const tb = document.querySelector(".topbar");
            if (!tb) return;
            const h = Math.ceil(tb.getBoundingClientRect().height);
            document.documentElement.style.setProperty("--topbar-h", h + "px");
        };
        updateTopbarVar();
        window.addEventListener("resize", debounce(updateTopbarVar, 100));
        if (typeof ResizeObserver !== "undefined") {
            const ro = new ResizeObserver(updateTopbarVar);
            const tb = document.querySelector(".topbar");
            if (tb) ro.observe(tb);
        }

        // Restore draft if user was creating a note
        try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (raw) {
                const d = JSON.parse(raw);
                if (d && (d.title || d.content || (d.tags && d.tags.length))) {
                    // Prompt asynchronously
                    setTimeout(async () => {
                        const ok = await confirmAction({
                            title: "Restore unsaved draft?",
                            body: "An unsaved note was found from a previous session."
                        });
                        if (ok) {
                            openEditor({
                                id: null,
                                title: d.title || "",
                                content: d.content || "",
                                tags: d.tags || [],
                                color: d.color || "default",
                                pinned: false,
                                archived: false,
                                trashed: false,
                                createdAt: Date.now(),
                                updatedAt: Date.now()
                            });
                        } else {
                            try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
                        }
                    }, 300);
                }
            }
        } catch (e) { /* ignore */ }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
