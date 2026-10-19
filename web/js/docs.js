/**
 * Sardine Documentation Engine
 * Handles JSON parsing, left sidebar accordion navigation, search filtering,
 * syntax highlighting, and fixed design template rendering.
 */

(function () {
    // Documentation State
    let docsData = null;
    let currentTopicId = null;
    let categoryExpandedState = {};
    let allTopicIds = [];
    let isDocsInitialized = false;

    // Load documentation data from global or via fetch
    async function loadDocsData() {
        if (window.SARDINE_DOCS_DATA) {
            docsData = window.SARDINE_DOCS_DATA;
        } else {
            try {
                const response = await fetch('docs-data.json');
                docsData = await response.json();
            } catch (err) {
                console.error('Failed to load docs-data.json:', err);
                return null;
            }
        }

        // Initialize topic sequential list and default expanded categories
        allTopicIds = [];
        if (docsData && docsData.categories) {
            docsData.categories.forEach((cat, index) => {
                // Expand the first 3 categories by default
                categoryExpandedState[cat.id] = index < 4;
                if (cat.items) {
                    cat.items.forEach(itemId => {
                        if (docsData.topics[itemId]) {
                            allTopicIds.push(itemId);
                        }
                    });
                }
            });
        }

        return docsData;
    }

    // Helper to safely escape HTML entities
    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Custom Sardine Syntax Highlighter (Single-Pass Tokenizer with Catppuccin Mocha Palette)
    function highlightSardineSyntax(code) {
        if (!code) return '';

        // Token specification: order of matching matters!
        const tokenRegex = new RegExp([
            '(#[^\\n]*)',                                                // 1: comments (# ...)
            '(\\$?"(?:[^"\\\\\\n]|\\\\.)*"?|\'[^\'\\\\\\n]*\')',          // 2: strings & f-strings
            '(\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)',               // 3: numbers
            '(\\b(?:model|init|method|attr|open|guarded|secret|proceed|escape|yield|menu|choice|fallback|risk|trap|clean|during|cycle|trace|summon|from|as|when|orwhen|otherwise|and|or|not)\\b)', // 4: keywords
            '(\\b(?:Integer|Float|String|Boolean|List|Dictionary|Null|None|null|True|False)\\b)', // 5: types
            '(\\b(?:show|listen|type|len|range|is_a|fopen|exit|throw|super)\\b)',                 // 6: builtins
            '(->|<-|==|!=|<=|>=|\\+=|-=|\\*=|/=|%=|//=|\\*\\*=|&=|\\^=|\\|=|<<=|>>=|\\*\\*|//|[+\\-*/%&|^~<>=?:!])', // 7: operators
            '([a-zA-Z_]\\w*)',                                           // 8: identifiers
            '([{}()\\[\\],;.])',                                         // 9: delimiter/punctuation
            '([^\\S\\r\\n]+)',                                           // 10: horizontal whitespace
            '(\\r?\\n)'                                                  // 11: newline
        ].join('|'), 'g');

        const lines = [[]];
        let match;

        while ((match = tokenRegex.exec(code)) !== null) {
            const [
                full, comment, str, num, kw, type, builtin, op, ident, punct, ws, nl
            ] = match;

            if (nl) {
                lines.push([]);
                continue;
            }

            const currentLine = lines[lines.length - 1];

            if (comment) {
                currentLine.push(`<span class="token-comment font-mono select-none">${escapeHtml(comment)}</span>`);
            } else if (str) {
                currentLine.push(`<span class="token-string">${escapeHtml(str)}</span>`);
            } else if (num) {
                currentLine.push(`<span class="token-number">${escapeHtml(num)}</span>`);
            } else if (kw) {
                currentLine.push(`<span class="token-keyword">${escapeHtml(kw)}</span>`);
            } else if (type) {
                currentLine.push(`<span class="token-type">${escapeHtml(type)}</span>`);
            } else if (builtin) {
                currentLine.push(`<span class="token-builtin">${escapeHtml(builtin)}</span>`);
            } else if (op) {
                currentLine.push(`<span class="token-operator">${escapeHtml(op)}</span>`);
            } else if (ident) {
                currentLine.push(`<span class="token-ident">${escapeHtml(ident)}</span>`);
            } else if (punct) {
                currentLine.push(`<span class="token-punct">${escapeHtml(punct)}</span>`);
            } else if (ws) {
                currentLine.push(escapeHtml(ws));
            } else {
                currentLine.push(escapeHtml(full));
            }
        }

        const highlightedLines = lines.map((tokens, idx) => {
            const lineContent = tokens.join('') || '&nbsp;';
            const lineNum = idx + 1;
            return `<div class="table-row group hover:bg-slate-800/40">
                <span class="table-cell pr-4 text-right select-none text-slate-600 text-xs font-mono w-10">${lineNum}</span>
                <span class="table-cell font-mono text-xs text-[#cdd6f4] leading-relaxed whitespace-pre">${lineContent}</span>
            </div>`;
        });

        return `<div class="table w-full border-collapse font-mono py-1">${highlightedLines.join('')}</div>`;
    }


    // Markdown-like text parser for explanations
    function formatExplanationText(text) {
        if (!text) return '';
        // Split into paragraphs
        const paragraphs = text.split('\n\n');
        return paragraphs.map(p => {
            let trimmed = p.trim();
            if (!trimmed) return '';

            // Handle bullet points
            if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || trimmed.includes('\n* ') || trimmed.includes('\n- ')) {
                const items = trimmed.split(/\n[\*\-]\s+/).filter(Boolean);
                const listHtml = items.map(item => {
                    const cleanItem = item.replace(/^[\*\-]\s+/, '');
                    return `<li class="flex items-start space-x-2 text-sm text-slate-300 leading-relaxed">
                        <span class="h-1.5 w-1.5 rounded-full bg-indigo-400 mt-2 shrink-0"></span>
                        <span>${formatInlineMarkdown(cleanItem)}</span>
                    </li>`;
                }).join('');
                return `<ul class="space-y-2 my-3 pl-1">${listHtml}</ul>`;
            }

            // Numbered list
            if (/^\d+\.\s+/.test(trimmed)) {
                const items = trimmed.split(/\n\d+\.\s+/).filter(Boolean);
                const listHtml = items.map((item, idx) => {
                    const cleanItem = item.replace(/^\d+\.\s+/, '');
                    return `<li class="flex items-start space-x-2 text-sm text-slate-300 leading-relaxed">
                        <span class="text-xs font-mono font-bold text-indigo-400 mt-0.5 shrink-0">${idx + 1}.</span>
                        <span>${formatInlineMarkdown(cleanItem)}</span>
                    </li>`;
                }).join('');
                return `<ol class="space-y-2 my-3 pl-1">${listHtml}</ol>`;
            }

            return `<p class="text-sm text-slate-300 leading-relaxed">${formatInlineMarkdown(trimmed)}</p>`;
        }).join('');
    }

    // Format inline markdown (bold, italic, code chips)
    function formatInlineMarkdown(str) {
        return str
            .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-100">$1</strong>')
            .replace(/\*(.*?)\*/g, '<em class="italic text-slate-200">$1</em>')
            .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-indigo-300 text-xs font-mono font-semibold">$1</code>');
    }

    // ==========================================
    // DESIGN TEMPLATES RENDERERS
    // ==========================================

    // Template: Topic Heading Header
    function renderTopicHeader(topic) {
        const category = docsData.categories.find(c => c.id === topic.category);
        const catName = category ? category.name : 'Documentation';

        return `
        <div class="border-b border-slate-800/80 pb-6 space-y-3">
            <div class="flex items-center space-x-2">
                <span class="px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    ${topic.badge || 'Sardine Construct'}
                </span>
                <span class="text-xs text-slate-500 font-medium">${catName}</span>
            </div>
            <h1 class="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight flex items-center space-x-3">
                <span>${topic.title}</span>
            </h1>
            <p class="text-base text-slate-400 leading-relaxed font-sans max-w-3xl">
                ${topic.summary || ''}
            </p>
        </div>`;
    }

    // Template: Explanation Section
    function renderExplanation(section) {
        const titleHtml = section.title ? `
            <div class="flex items-center space-x-2 text-indigo-400 font-bold text-lg border-b border-slate-800/60 pb-2 mb-3">
                <i data-lucide="info" class="h-4 w-4"></i>
                <h3 class="text-slate-100">${section.title}</h3>
            </div>` : '';

        return `
        <section class="space-y-3">
            ${titleHtml}
            <div class="space-y-3 font-sans">
                ${formatExplanationText(section.content)}
            </div>
        </section>`;
    }

    // Template: Syntax Blueprint Section
    function renderSyntax(section) {
        return `
        <section class="space-y-2">
            <div class="flex items-center space-x-2 text-sky-400 font-bold text-sm tracking-wide uppercase">
                <i data-lucide="code" class="h-4 w-4"></i>
                <span class="text-xs font-mono">${section.title || 'Syntax Blueprint'}</span>
            </div>
            <div class="rounded-xl border border-sky-500/20 bg-slate-900/60 p-4 font-mono text-xs text-sky-200 overflow-x-auto shadow-inner relative group">
                <pre class="leading-relaxed whitespace-pre font-mono">${section.content}</pre>
            </div>
        </section>`;
    }

    // Template: Code Example with Syntax Highlighting and Run in Editor
    function renderExample(section, topic) {
        const filename = section.filename || 'example.sad';
        const rawCode = section.code || '';
        const escapedCode = encodeURIComponent(rawCode);

        return `
        <section class="space-y-2">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2 text-amber-400 font-bold text-sm">
                    <i data-lucide="file-code" class="h-4 w-4"></i>
                    <span class="text-slate-200 text-sm font-bold">${section.title || 'Code Example'}</span>
                </div>
            </div>

            <!-- Code Block Container -->
            <div class="rounded-2xl border border-slate-800 bg-[#1e1e2e] overflow-hidden shadow-2xl relative">
                <!-- Code Header Bar -->
                <div class="px-4 py-2.5 bg-[#181825] border-b border-slate-800 flex items-center justify-between text-xs">
                    <div class="flex items-center space-x-2 text-slate-400 font-mono">
                        <i data-lucide="terminal" class="h-3.5 w-3.5 text-indigo-400"></i>
                        <span class="text-slate-300 font-semibold">${filename}</span>
                        <span class="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">sardine</span>
                    </div>

                    <div class="flex items-center space-x-2">
                        <button onclick="copyCodeSnippet(this, decodeURIComponent('${escapedCode}'))" 
                            class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all flex items-center space-x-1.5 text-xs font-medium cursor-pointer" title="Copy code snippet">
                            <i data-lucide="copy" class="h-3.5 w-3.5"></i>
                            <span class="btn-copy-label">Copy</span>
                        </button>
                        <button onclick="tryCodeInEditor(decodeURIComponent('${escapedCode}'))" 
                            class="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center space-x-1.5 text-xs font-bold shadow-sm shadow-indigo-600/30 hover:scale-[1.02] active:scale-95 cursor-pointer" title="Run in Editor Playground">
                            <i data-lucide="play" class="h-3.5 w-3.5 fill-current"></i>
                            <span>Run</span>
                        </button>
                    </div>
                </div>

                <!-- Highlighted Body -->
                <div class="p-4 overflow-x-auto max-h-[500px]">
                    ${highlightSardineSyntax(rawCode)}
                </div>
            </div>
        </section>`;
    }

    // Template: Output Section (Terminal Card)
    function renderOutput(section) {
        return `
        <section class="space-y-2">
            <div class="rounded-2xl border border-slate-800/90 bg-[#11111b] overflow-hidden shadow-xl">
                <!-- Terminal Header Bar -->
                <div class="px-4 py-2 bg-[#181825] border-b border-slate-800/80 flex items-center justify-between text-xs">
                    <div class="flex items-center space-x-2">
                        <div class="flex items-center space-x-1.5">
                            <div class="w-2.5 h-2.5 rounded-full bg-rose-500/80"></div>
                            <div class="w-2.5 h-2.5 rounded-full bg-amber-500/80"></div>
                            <div class="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></div>
                        </div>
                        <span class="text-[11px] font-mono tracking-widest uppercase text-slate-400 font-semibold pl-2">
                            ${section.title || 'Execution Output'}
                        </span>
                    </div>
                    <span class="text-[10px] font-mono text-emerald-400 flex items-center space-x-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>STDOUT</span>
                    </span>
                </div>

                <!-- Terminal Body -->
                <div class="p-4 font-mono text-xs text-emerald-300/90 overflow-x-auto leading-relaxed whitespace-pre selection:bg-emerald-500/30">
${section.content}</div>
            </div>
        </section>`;
    }

    // Template: Callout Alerts (Tip, Note, Warning)
    function renderAlert(section, type) {
        const configs = {
            tip: {
                icon: 'lightbulb',
                border: 'border-emerald-500/30',
                bg: 'bg-emerald-950/20',
                text: 'text-emerald-400',
                badge: 'Tip / Best Practice'
            },
            note: {
                icon: 'bookmark',
                border: 'border-indigo-500/30',
                bg: 'bg-indigo-950/20',
                text: 'text-indigo-400',
                badge: 'Note / Technical Context'
            },
            warning: {
                icon: 'alert-triangle',
                border: 'border-amber-500/30',
                bg: 'bg-amber-950/20',
                text: 'text-amber-400',
                badge: 'Warning / Sandbox Rule'
            }
        };

        const cfg = configs[type] || configs.note;

        return `
        <div class="rounded-2xl border ${cfg.border} ${cfg.bg} p-5 flex items-start space-x-3.5 shadow-md">
            <div class="${cfg.text} shrink-0 mt-0.5">
                <i data-lucide="${cfg.icon}" class="h-5 w-5"></i>
            </div>
            <div class="space-y-1 font-sans flex-1 min-w-0">
                <h4 class="text-xs font-bold uppercase tracking-wider ${cfg.text}">${section.title || cfg.badge}</h4>
                <div class="text-sm text-slate-300 leading-relaxed">
                    ${formatExplanationText(section.content)}
                </div>
            </div>
        </div>`;
    }

    // Template: Structured Table (Methods, Operators, Parameters)
    function renderTable(section) {
        const headers = section.headers || [];
        const rows = section.rows || [];

        const headerHtml = headers.map(h => `
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-300 uppercase tracking-wider bg-slate-900/80 border-b border-slate-800">
                ${h}
            </th>
        `).join('');

        const rowsHtml = rows.map((r, idx) => `
            <tr class="hover:bg-slate-900/50 transition-colors border-b border-slate-800/60 ${idx % 2 === 1 ? 'bg-slate-950/30' : ''}">
                ${r.map((cell, cIdx) => `
                    <td class="px-4 py-3 text-xs ${cIdx === 0 ? 'font-mono font-bold text-indigo-300' : (cIdx === 1 ? 'font-mono text-slate-300' : 'text-slate-400')}">
                        ${formatInlineMarkdown(cell)}
                    </td>
                `).join('')}
            </tr>
        `).join('');

        return `
        <section class="space-y-3">
            ${section.title ? `
            <h3 class="text-sm font-bold text-slate-200 tracking-wide uppercase flex items-center space-x-2">
                <i data-lucide="table" class="h-4 w-4 text-indigo-400"></i>
                <span>${section.title}</span>
            </h3>` : ''}
            <div class="rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
                <div class="overflow-x-auto">
                    <table class="w-full border-collapse">
                        <thead>
                            <tr>${headerHtml}</tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>`;
    }

    // Render entire Article from Topic JSON
    function renderTopicArticle(topic) {
        const articleContainer = document.getElementById('docs-article');
        if (!articleContainer || !topic) return;

        let html = renderTopicHeader(topic);

        if (topic.sections && Array.isArray(topic.sections)) {
            topic.sections.forEach(sec => {
                switch (sec.tag) {
                    case 'explanation':
                        html += renderExplanation(sec);
                        break;
                    case 'syntax':
                        html += renderSyntax(sec);
                        break;
                    case 'example':
                        html += renderExample(sec, topic);
                        break;
                    case 'output':
                        html += renderOutput(sec);
                        break;
                    case 'tip':
                        html += renderAlert(sec, 'tip');
                        break;
                    case 'note':
                        html += renderAlert(sec, 'note');
                        break;
                    case 'warning':
                        html += renderAlert(sec, 'warning');
                        break;
                    case 'table':
                    case 'methods':
                        html += renderTable(sec);
                        break;
                    default:
                        html += renderExplanation(sec);
                        break;
                }
            });
        }

        articleContainer.innerHTML = html;

        // Update breadcrumb
        const category = docsData.categories.find(c => c.id === topic.category);
        const breadcrumbCat = document.getElementById('docs-breadcrumb-cat');
        const breadcrumbTitle = document.getElementById('docs-breadcrumb-title');
        if (breadcrumbCat) breadcrumbCat.textContent = category ? category.name : 'Docs';
        if (breadcrumbTitle) breadcrumbTitle.textContent = topic.title;

        // Update Prev / Next buttons
        updatePaginationButtons();

        // Refresh icons
        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }

        // Scroll to top of content
        const contentContainer = document.getElementById('docs-content-container');
        if (contentContainer) {
            contentContainer.scrollTop = 0;
        }
    }

    // Update Previous and Next buttons in footer
    function updatePaginationButtons() {
        const currentIndex = allTopicIds.indexOf(currentTopicId);
        const prevBtn = document.getElementById('docs-nav-prev');
        const nextBtn = document.getElementById('docs-nav-next');
        const prevTitle = document.getElementById('docs-prev-title');
        const nextTitle = document.getElementById('docs-next-title');

        if (currentIndex > 0) {
            const prevId = allTopicIds[currentIndex - 1];
            const prevTopic = docsData.topics[prevId];
            if (prevBtn) prevBtn.classList.remove('invisible');
            if (prevTitle) prevTitle.textContent = prevTopic ? prevTopic.title : 'Previous';
        } else {
            if (prevBtn) prevBtn.classList.add('invisible');
        }

        if (currentIndex !== -1 && currentIndex < allTopicIds.length - 1) {
            const nextId = allTopicIds[currentIndex + 1];
            const nextTopic = docsData.topics[nextId];
            if (nextBtn) nextBtn.classList.remove('invisible');
            if (nextTitle) nextTitle.textContent = nextTopic ? nextTopic.title : 'Next';
        } else {
            if (nextBtn) nextBtn.classList.add('invisible');
        }
    }

    // ==========================================
    // SIDEBAR ACCORDION & SEARCH RENDERING
    // ==========================================

    function renderSidebar(searchFilter = '') {
        const container = document.getElementById('docs-accordion-container');
        if (!container || !docsData) return;

        const filterLower = searchFilter.trim().toLowerCase();
        let totalVisibleTopics = 0;
        let html = '';

        docsData.categories.forEach(cat => {
            // Filter topics in this category
            const matchingItems = cat.items.filter(itemId => {
                const topic = docsData.topics[itemId];
                if (!topic) return false;
                if (!filterLower) return true;
                return (
                    topic.title.toLowerCase().includes(filterLower) ||
                    (topic.summary && topic.summary.toLowerCase().includes(filterLower)) ||
                    (topic.badge && topic.badge.toLowerCase().includes(filterLower)) ||
                    itemId.toLowerCase().includes(filterLower)
                );
            });

            if (filterLower && matchingItems.length === 0) {
                return; // Hide category if no match
            }

            totalVisibleTopics += matchingItems.length;

            // Auto-expand category if search filter is active
            const isExpanded = filterLower ? true : !!categoryExpandedState[cat.id];
            const chevronClass = isExpanded ? 'rotate-90' : '';
            const itemsContainerClass = isExpanded ? '' : 'hidden';

            const itemsHtml = matchingItems.map(itemId => {
                const topic = docsData.topics[itemId];
                const isActive = (itemId === currentTopicId);
                const activeClasses = isActive
                    ? 'bg-indigo-500/15 text-indigo-300 font-bold border-l-2 border-indigo-400 pl-2.5 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 pl-3';

                return `
                <button onclick="selectDocTopic('${itemId}')"
                    class="w-full text-left py-2 pr-2.5 rounded-lg text-xs font-sans transition-all flex items-center justify-between group cursor-pointer ${activeClasses}">
                    <span class="truncate flex items-center space-x-2">
                        <span class="w-1.5 h-1.5 rounded-full ${isActive ? 'bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]' : 'bg-slate-700 group-hover:bg-slate-500'} shrink-0"></span>
                        <span class="truncate">${topic.title}</span>
                    </span>
                    ${isActive ? '<i data-lucide="chevron-right" class="h-3.5 w-3.5 text-indigo-400 shrink-0"></i>' : ''}
                </button>`;
            }).join('');

            html += `
            <div class="rounded-xl border border-slate-800/80 bg-slate-950/40 overflow-hidden mb-1.5 transition-all">
                <!-- Accordion Header -->
                <button onclick="toggleDocCategory('${cat.id}')"
                    class="w-full px-3 py-2.5 flex items-center justify-between text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-900/50 transition-colors select-none cursor-pointer">
                    <div class="flex items-center space-x-2.5 truncate">
                        <i data-lucide="${cat.icon || 'folder'}" class="h-4 w-4 text-indigo-400 shrink-0"></i>
                        <span class="truncate font-bold tracking-tight">${cat.name}</span>
                    </div>
                    <div class="flex items-center space-x-2 shrink-0">
                        <span class="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 font-bold">
                            ${matchingItems.length}
                        </span>
                        <i data-lucide="chevron-right" class="h-3.5 w-3.5 text-slate-500 transition-transform duration-200 ${chevronClass}"></i>
                    </div>
                </button>

                <!-- Accordion Content Items -->
                <div id="cat-items-${cat.id}" class="px-2 py-1 space-y-0.5 border-t border-slate-800/40 ${itemsContainerClass}">
                    ${itemsHtml}
                </div>
            </div>`;
        });

        if (totalVisibleTopics === 0) {
            html = `
            <div class="p-6 text-center text-slate-500 space-y-2">
                <i data-lucide="search-x" class="h-8 w-8 mx-auto text-slate-600"></i>
                <p class="text-xs">No documentation topics found for "<span class="text-slate-300">${searchFilter}</span>"</p>
                <button onclick="clearDocsSearch()" class="text-xs text-indigo-400 hover:underline font-bold cursor-pointer">Clear Search</button>
            </div>`;
        }

        container.innerHTML = html;

        // Update search status info
        const statusEl = document.getElementById('docs-search-status');
        if (statusEl) {
            statusEl.textContent = filterLower
                ? `${totalVisibleTopics} result${totalVisibleTopics === 1 ? '' : 's'} found`
                : 'Browse language guide';
        }

        const countBadge = document.getElementById('docs-topics-count');
        if (countBadge && docsData) {
            countBadge.textContent = filterLower
                ? `${totalVisibleTopics} Match${totalVisibleTopics === 1 ? '' : 'es'}`
                : `${allTopicIds.length} Topics`;
        }

        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    }

    // Toggle specific category accordion
    window.toggleDocCategory = function (catId) {
        categoryExpandedState[catId] = !categoryExpandedState[catId];
        renderSidebar(getSearchQuery());
    };

    // Toggle All Categories
    window.toggleAllDocCategories = function () {
        const anyClosed = Object.values(categoryExpandedState).some(v => !v);
        docsData.categories.forEach(c => {
            categoryExpandedState[c.id] = anyClosed;
        });
        const btn = document.getElementById('btn-toggle-all-cats');
        if (btn) btn.textContent = anyClosed ? 'Collapse All' : 'Expand All';
        renderSidebar(getSearchQuery());
    };

    function getSearchQuery() {
        const searchInput = document.getElementById('docs-search-input');
        return searchInput ? searchInput.value : '';
    }

    // Clear search
    window.clearDocsSearch = function () {
        const searchInput = document.getElementById('docs-search-input');
        const clearBtn = document.getElementById('docs-search-clear');
        if (searchInput) searchInput.value = '';
        if (clearBtn) clearBtn.classList.add('hidden');
        renderSidebar('');
    };

    // Toggle Mobile / Desktop Sidebar
    window.toggleDocsSidebar = function () {
        const sidebar = document.getElementById('docs-sidebar');
        if (sidebar) {
            sidebar.classList.toggle('hidden');
        }
    };

    // ==========================================
    // SELECTION & INTERACTION ACTIONS
    // ==========================================

    // Select and display a topic
    window.selectDocTopic = function (topicId, updateHash = true) {
        if (!docsData || !docsData.topics[topicId]) {
            // Default to overview if topicId not found
            topicId = 'overview';
        }

        currentTopicId = topicId;
        const topic = docsData.topics[topicId];

        // Ensure parent category is expanded
        if (topic && topic.category) {
            categoryExpandedState[topic.category] = true;
        }

        // Render Article
        renderTopicArticle(topic);

        // Re-render sidebar to highlight active item
        renderSidebar(getSearchQuery());

        // Update URL hash
        if (updateHash) {
            window.location.hash = '#/docs/' + topicId;
        }
    };

    // Previous / Next Topic Navigator
    window.navigateDocTopic = function (delta) {
        const currentIndex = allTopicIds.indexOf(currentTopicId);
        if (currentIndex === -1) return;
        const targetIndex = currentIndex + delta;
        if (targetIndex >= 0 && targetIndex < allTopicIds.length) {
            selectDocTopic(allTopicIds[targetIndex], true);
        }
    };

    // Copy Code Snippet helper
    window.copyCodeSnippet = function (btn, code) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code).then(() => {
                const label = btn.querySelector('.btn-copy-label');
                if (label) {
                    const originalText = label.textContent;
                    label.textContent = 'Copied!';
                    btn.classList.add('text-emerald-400');
                    setTimeout(() => {
                        label.textContent = originalText;
                        btn.classList.remove('text-emerald-400');
                    }, 1800);
                }
            });
        }
    };

    // Copy Direct Topic URL Link
    window.copyCurrentDocLink = function () {
        const url = window.location.origin + window.location.pathname + '#/docs/' + currentTopicId;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => {
                const btnText = document.getElementById('btn-copy-link-text');
                if (btnText) {
                    btnText.textContent = 'Copied Link!';
                    setTimeout(() => {
                        btnText.textContent = 'Share';
                    }, 1800);
                }
            });
        }
    };

    // Open Topic in Interactive Playground
    window.tryCodeInEditor = function (code) {
        if (!code) return;

        // Set code into virtual main.sad
        if (window.virtualFiles) {
            window.virtualFiles['main.sad'] = code;
        }

        // Update Monaco instance if available
        if (window.editorInstance) {
            window.editorInstance.setValue(code);
        }

        // Route to editor
        window.location.hash = '#/editor';
    };

    // Open first code example from current topic
    window.openCurrentTopicInEditor = function () {
        if (!currentTopicId || !docsData) return;
        const topic = docsData.topics[currentTopicId];
        if (!topic || !topic.sections) return;

        const exampleSec = topic.sections.find(s => s.tag === 'example');
        if (exampleSec && exampleSec.code) {
            tryCodeInEditor(exampleSec.code);
        }
    };

    // Main Init Function called when router switches to #/docs
    window.onDocsRouteActive = function (rawHash) {
        if (!docsData) {
            loadDocsData().then(data => {
                if (data) {
                    initFromHash(rawHash);
                }
            });
        } else {
            initFromHash(rawHash);
        }
    };

    function initFromHash(rawHash) {
        let topicId = 'overview';
        if (rawHash && rawHash.startsWith('#/docs/')) {
            const requested = rawHash.replace('#/docs/', '').trim();
            if (requested && docsData && docsData.topics[requested]) {
                topicId = requested;
            }
        }

        if (!isDocsInitialized || currentTopicId !== topicId) {
            selectDocTopic(topicId, false);
            isDocsInitialized = true;
        }
    }

    // Initialize Search Input Listener
    document.addEventListener('DOMContentLoaded', () => {
        const searchInput = document.getElementById('docs-search-input');
        const clearBtn = document.getElementById('docs-search-clear');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const val = e.target.value;
                if (clearBtn) {
                    if (val) clearBtn.classList.remove('hidden');
                    else clearBtn.classList.add('hidden');
                }
                renderSidebar(val);
            });
        }

        // Load data in background early
        loadDocsData();
    });

})();

